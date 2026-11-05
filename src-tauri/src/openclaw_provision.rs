//! 运行时自动下载 / 解压 OpenClaw 便携运行时，并初始化配置。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::gateway_supervisor::GatewaySupervisor;
use crate::openclaw::bundled_openclaw_ready;
use crate::openclaw_exec::{stop_all_gateways, verify_runtime_for_preference};
use crate::openclaw_runtime::{self, RuntimeSource};
use crate::openclaw_bootstrap::{
    ensure_openclaw_cmd, ensure_openclaw_portable_runtime, has_bundled_payload_zip,
    openclaw_runtime_ready, seed_openclaw_data_defaults,
};
use crate::openclaw_control::establish_absolute_control;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// 预登录也可调用；限制频率，避免反复 stop_all / 重装抖动。
static LAST_PROVISION_START_AT: Mutex<Option<Instant>> = Mutex::new(None);
const PROVISION_START_COOLDOWN: Duration = Duration::from_secs(12);
use zip::ZipArchive;

const NODE_VERSION: &str = env!("OPENCLAW_RUNTIME_NODE_VERSION");
const OPENCLAW_VERSION: &str = env!("OPENCLAW_RUNTIME_OPENCLAW_VERSION");
const NODE_WIN_SHA256: &str = env!("OPENCLAW_RUNTIME_NODE_WIN_SHA256");

/// 失败路径自动清理临时目录（成功时调用 `disarm` 避免误删已搬迁目录）。
struct DirCleanupGuard {
    path: Option<PathBuf>,
}

impl DirCleanupGuard {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }

    fn disarm(&mut self) {
        self.path = None;
    }
}

impl Drop for DirCleanupGuard {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            if path.exists() {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionSnapshot {
    pub needed: bool,
    pub ready: bool,
    pub running: bool,
    pub phase: String,
    pub percent: u8,
    pub message: String,
    pub error: Option<String>,
    pub choice_required: bool,
    pub global_available: bool,
    pub global_version: Option<String>,
    pub bundled_ready: bool,
    pub bundled_install_available: bool,
    pub bundled_version: String,
    pub runtime_source: Option<String>,
}

#[derive(Default)]
struct ProvisionInner {
    running: bool,
    phase: String,
    percent: u8,
    message: String,
    error: Option<String>,
    done: bool,
}

#[derive(Clone)]
pub struct OpenClawProvisionState {
    inner: Arc<Mutex<ProvisionInner>>,
    start_guard: Arc<AtomicBool>,
}

impl Default for OpenClawProvisionState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProvisionInner::default())),
            start_guard: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl OpenClawProvisionState {
    fn update(&self, phase: &str, percent: u8, message: &str) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.phase = phase.into();
        g.percent = percent;
        g.message = message.into();
    }

    fn set_error(&self, err: String) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.error = Some(err);
        g.running = false;
    }

    fn mark_done(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.done = true;
        g.running = false;
        g.phase = "done".into();
        g.percent = 100;
        g.message = "本机服务已就绪".into();
        g.error = None;
    }

    fn mark_running(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.running = true;
        g.error = None;
        g.done = false;
    }

    pub fn snapshot(&self) -> ProvisionSnapshot {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let discover = openclaw_runtime::runtime_discover();
        let pref = openclaw_runtime::load_runtime_preference()
            .ok()
            .flatten()
            .or_else(|| {
                discover
                    .runtime_source
                    .as_deref()
                    .and_then(RuntimeSource::from_str_loose)
            });
        let effective = openclaw_runtime::effective_source(pref);
        let runtime_ready = openclaw_runtime::runtime_available_for(effective) || g.done;
        let needed = !runtime_ready && !g.done && can_provision_for(effective);
        ProvisionSnapshot {
            needed,
            ready: runtime_ready || g.done,
            running: g.running,
            phase: g.phase.clone(),
            percent: g.percent,
            message: g.message.clone(),
            error: g.error.clone(),
            choice_required: discover.choice_required,
            global_available: discover.global_available,
            global_version: discover.global_version,
            bundled_ready: discover.bundled_ready,
            bundled_install_available: discover.bundled_install_available,
            bundled_version: discover.bundled_version,
            runtime_source: discover.runtime_source,
        }
    }
}

pub fn is_openclaw_available() -> bool {
    let pref = openclaw_runtime::load_runtime_preference().ok().flatten();
    openclaw_runtime::runtime_available_for(openclaw_runtime::effective_source(pref))
}


fn can_provision_for(_source: RuntimeSource) -> bool {
    has_bundled_payload_zip() || should_download_runtime()
}

pub fn needs_provision() -> bool {
    let pref = openclaw_runtime::load_runtime_preference().ok().flatten();
    let effective = openclaw_runtime::effective_source(pref);
    !openclaw_runtime::runtime_available_for(effective) && can_provision_for(effective)
}

fn should_download_runtime() -> bool {
    !bundled_openclaw_ready() && !has_bundled_payload_zip()
}

fn portable_dir() -> Result<PathBuf, String> {
    Ok(paths::installed_dir()?.join("openclaw-portable"))
}

fn emit_progress(app: &AppHandle, state: &OpenClawProvisionState) {
    let snap = state.snapshot();
    let _ = app.emit("openclaw-provision-progress", snap);
}

fn verify_download_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    let expected = expected_hex.trim();
    if expected.is_empty() {
        return Ok(());
    }
    use sha2::{Digest, Sha256};
    let mut file = File::open(path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("读取 {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let digest = hasher.finalize();
    let actual = digest
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!(
            "下载校验失败：SHA256 不匹配（期望 {expected}，实际 {actual}）"
        ))
    }
}

fn download_file_with_progress(
    url: &str,
    dest: &Path,
    base_percent: u8,
    span_percent: u8,
    state: &OpenClawProvisionState,
    app: &AppHandle,
) -> Result<(), String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(300))
        .call()
        .map_err(|e| format!("下载失败 ({url}): {e}"))?;
    let total = resp
        .header("Content-Length")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = File::create(dest).map_err(|e| format!("无法写入 {}: {e}", dest.display()))?;
    let mut downloaded = 0u64;
    let mut buf = [0u8; 65536];
    let mut last_emit_pct = 0u8;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取下载流失败: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("写入 {}: {e}", dest.display()))?;
        downloaded += n as u64;
        if total > 0 {
            let ratio = downloaded
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(0)
                .min(100) as u8;
            let pct = base_percent.saturating_add((ratio * span_percent / 100).min(span_percent));
            if pct >= last_emit_pct.saturating_add(1) || ratio >= 100 {
                last_emit_pct = pct;
                state.update(
                    "download",
                    pct,
                    &format!("正在下载 Node.js 运行时… {ratio}%"),
                );
                emit_progress(app, state);
            }
        } else if last_emit_pct == 0 {
            last_emit_pct = base_percent;
            state.update("download", base_percent, "正在下载 Node.js 运行时…");
            emit_progress(app, state);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn node_archive_name() -> &'static str {
    env!("OPENCLAW_RUNTIME_NODE_WIN_ARCHIVE")
}

#[cfg(target_os = "windows")]
fn node_extract_folder() -> &'static str {
    env!("OPENCLAW_RUNTIME_NODE_WIN_FOLDER")
}

fn extract_node_windows_zip(zip_path: &Path, node_runtime_dir: &Path) -> Result<(), String> {
    let expand_root = node_runtime_dir
        .parent()
        .ok_or_else(|| "无效 staging 路径".to_string())?
        .join("_expand_node");
    let mut expand_guard = DirCleanupGuard::new(expand_root.clone());
    if expand_root.exists() {
        fs::remove_dir_all(&expand_root).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&expand_root).map_err(|e| e.to_string())?;

    let file = File::open(zip_path).map_err(|e| format!("无法打开 {}: {e}", zip_path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("无法读取 zip: {e}"))?;

    let mut created_dirs: HashSet<PathBuf> = HashSet::new();
    let mut buf = [0u8; 65536];

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out = expand_root.join(rel);
        if entry.is_dir() {
            if created_dirs.insert(out.clone()) {
                fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            }
            continue;
        }
        if let Some(parent) = out.parent() {
            if created_dirs.insert(parent.to_path_buf()) {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        let mut out_file = File::create(&out).map_err(|e| e.to_string())?;
        loop {
            let n = entry.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            out_file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        }
    }

    let extracted = expand_root.join(node_extract_folder());
    if !extracted.is_dir() {
        return Err(format!(
            "Node 解压后未找到 {} 目录",
            node_extract_folder()
        ));
    }
    if node_runtime_dir.exists() {
        fs::remove_dir_all(node_runtime_dir).map_err(|e| e.to_string())?;
    }
    fs::rename(&extracted, node_runtime_dir).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&expand_root);
    expand_guard.disarm();
    Ok(())
}

fn npm_install_openclaw(
    node_runtime_dir: &Path,
    npm_prefix: &Path,
    state: &OpenClawProvisionState,
    app: &AppHandle,
) -> Result<(), String> {
    fs::create_dir_all(npm_prefix).map_err(|e| e.to_string())?;

    let npm_prefix_str = npm_prefix.to_string_lossy().to_string();
    let pkg = format!("openclaw@{OPENCLAW_VERSION}");
    let npm_cmd = node_runtime_dir.join("npm.cmd");

    let node_exe = node_runtime_dir.join("node.exe");

    let mut last_err = String::new();
    const MAX_RETRIES: u32 = 2;

    for attempt in 0..=MAX_RETRIES {
        let attempt_label = if attempt > 0 {
            format!("（第 {attempt}/{} 次重试）", MAX_RETRIES)
        } else {
            String::new()
        };
        state.update(
            "npm",
            50 + attempt as u8 * 5,
            &format!("正在安装本机服务组件 {OPENCLAW_VERSION}{attempt_label}…"),
        );
        emit_progress(app, state);

        let mut path_val = std::env::var("PATH").unwrap_or_default();
        path_val = format!("{};{}", node_runtime_dir.display(), path_val);
        let mut cmd = std::process::Command::new(&npm_cmd);
        cmd.env("PATH", &path_val);

        // 补全 Windows 环境变量：受限账户/服务账户下 npm 需要 USERPROFILE/TEMP/TMP 才能找到缓存目录
        #[cfg(target_os = "windows")]
        {
            if std::env::var("USERPROFILE").is_ok() {
                cmd.env("USERPROFILE", std::env::var("USERPROFILE").unwrap_or_default());
            }
            if std::env::var("TEMP").is_ok() {
                cmd.env("TEMP", std::env::var("TEMP").unwrap_or_default());
            }
            if std::env::var("TMP").is_ok() {
                cmd.env("TMP", std::env::var("TMP").unwrap_or_default());
            }
        }

        cmd.args([
            "install",
            "--prefix",
            &npm_prefix_str,
            &pkg,
            "--omit=dev",
            "--loglevel",
            "error",
            "--no-audit",
            "--no-fund",
            "--registry",
            "https://registry.npmmirror.com",
        ]);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        crate::openclaw_exec::hide_console(&mut cmd);

        let output = crate::openclaw_exec::command_output_timed_full(
            cmd,
            std::time::Duration::from_secs(900),
        )
        .ok_or_else(|| "npm install 超时（15 分钟）".to_string())?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            last_err = format!(
                "npm install 本机服务组件失败 (exit {:?}): {stderr}{stdout}",
                output.status.code()
            );
            if attempt < MAX_RETRIES {
                // 清理可能残留的半成品 node_modules
                let bad_modules = npm_prefix.join("node_modules");
                if bad_modules.exists() {
                    let _ = fs::remove_dir_all(&bad_modules);
                }
                std::thread::sleep(std::time::Duration::from_millis(1500));
                continue;
            }
            return Err(last_err);
        }

        // 验证入口文件存在
        let entry = npm_prefix
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        if !entry.is_file() {
            last_err = "npm 安装完成但未找到服务入口脚本".into();
            if attempt < MAX_RETRIES {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                continue;
            }
            return Err(last_err);
        }

        // 验证安装版本与期望版本一致
        let mut version_cmd = std::process::Command::new(&node_exe);
        version_cmd
            .arg(&entry)
            .arg("--version")
            .env("PATH", &path_val)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        crate::openclaw_exec::hide_console(&mut version_cmd);

        match version_cmd.output() {
            Ok(vout) if vout.status.success() => {
                let ver = String::from_utf8_lossy(&vout.stdout).trim().to_string();
                if ver == OPENCLAW_VERSION {
                    return Ok(());
                }
                last_err = format!(
                    "安装的本机服务版本 ({ver}) 与期望 ({OPENCLAW_VERSION}) 不一致，可能是镜像缓存过期",
                );
                if attempt < MAX_RETRIES {
                    // 清除缓存重试
                    let bad_modules = npm_prefix.join("node_modules");
                    if bad_modules.exists() {
                        let _ = fs::remove_dir_all(&bad_modules);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    continue;
                }
                return Err(last_err);
            }
            Ok(vout) => {
                last_err = format!(
                    "本机服务 --version 验证失败: {}",
                    String::from_utf8_lossy(&vout.stderr).trim()
                );
                if attempt < MAX_RETRIES {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    continue;
                }
                return Err(last_err);
            }
            Err(e) => {
                last_err = format!("无法执行本机服务 --version 验证: {e}");
                if attempt < MAX_RETRIES {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    continue;
                }
                return Err(last_err);
            }
        }
    }

    Err(last_err)
}

fn download_and_install_runtime(
    state: &OpenClawProvisionState,
    app: &AppHandle,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, app);
        return Err(
            "当前平台暂不支持在线下载本机服务运行时，请使用完整安装包。"
                .into(),
        );
    }

    #[cfg(target_os = "windows")]
    {
    let portable = portable_dir()?;
    fs::create_dir_all(&portable).map_err(|e| e.to_string())?;

    let staging = portable.join("_download_staging");
    let mut staging_guard = DirCleanupGuard::new(staging.clone());
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let node_runtime = staging.join("node-runtime");
    let npm_prefix = staging.join("npm-prefix");

    let zip_name = node_archive_name();
    let url = format!("https://nodejs.org/dist/{NODE_VERSION}/{zip_name}");
    let tmp_zip = staging.join(zip_name);
    state.update("download", 0, "准备下载 Node.js 运行时…");
    emit_progress(app, state);
    download_file_with_progress(&url, &tmp_zip, 0, 35, state, app)?;
    verify_download_sha256(&tmp_zip, NODE_WIN_SHA256)?;

    state.update("extract", 40, "正在解压 Node.js…");
    emit_progress(app, state);
    fs::create_dir_all(&node_runtime).map_err(|e| e.to_string())?;
    extract_node_windows_zip(&tmp_zip, &node_runtime)?;
    let _ = fs::remove_file(&tmp_zip);

    let node_exe = node_runtime.join("node.exe");
    if !node_exe.is_file() {
        return Err("Node 解压后缺少 node.exe".into());
    }

    npm_install_openclaw(&node_runtime, &npm_prefix, state, app)?;

    state.update("finalize", 88, "正在写入本机服务运行时…");
    emit_progress(app, state);

    let dest_node = portable.join("node-runtime");
    let dest_npm = portable.join("npm-prefix");
    if dest_node.exists() {
        fs::remove_dir_all(&dest_node).map_err(|e| e.to_string())?;
    }
    if dest_npm.exists() {
        fs::remove_dir_all(&dest_npm).map_err(|e| e.to_string())?;
    }
    fs::rename(&node_runtime, &dest_node).map_err(|e| e.to_string())?;
    fs::rename(&npm_prefix, &dest_npm).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    staging_guard.disarm();

    if !bundled_openclaw_ready() {
        return Err("本机服务运行时安装后校验失败".into());
    }
    let _ = crate::openclaw_relay_waf_patch::patch_openclaw_npm_prefix_for_relay_waf(&dest_npm);
    crate::openclaw_bootstrap::write_portable_version();
    Ok(())
    }
}

fn coerce_bundled_source(source: RuntimeSource) -> RuntimeSource {
    match source {
        RuntimeSource::Bundled => RuntimeSource::Bundled,
        _ => RuntimeSource::Bundled,
    }
}

fn run_provision_pipeline(
    state: OpenClawProvisionState,
    app: AppHandle,
    source: RuntimeSource,
    stop_external: bool,
) {
    if stop_external {
        stop_all_gateways();
    }
    let source = coerce_bundled_source(source);
    state.mark_running();
    state.update("prepare", 2, "正在准备本机服务环境…");
    emit_progress(&app, &state);

    let result: Result<(), String> = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if !openclaw_runtime_ready() {
            if has_bundled_payload_zip() {
                state.update("extract", 15, "正在解压内置本机服务运行时…");
                emit_progress(&app, &state);
                let mut progress = |pct: u8, msg: &str| {
                    state.update("extract", pct, msg);
                    emit_progress(&app, &state);
                };
                ensure_openclaw_portable_runtime(Some(&mut progress))?;
            } else if should_download_runtime() {
                download_and_install_runtime(&state, &app)?;
            } else {
                return Err("无法安装内置本机服务运行时（缺少安装包且当前平台不支持在线下载）。".into());
            }
        } else {
            crate::openclaw_bootstrap::write_portable_version();
        }

        ensure_openclaw_cmd()?;
        state.update("configure", 92, "正在初始化本机服务配置…");
        emit_progress(&app, &state);
        seed_openclaw_data_defaults()?;
        state.update("control", 96, "正在写入管控策略（可能需要几十秒）…");
        emit_progress(&app, &state);
        establish_absolute_control(true)?;
        state.update("control", 97, "管控策略已应用");
        emit_progress(&app, &state);

        state.update("verify", 98, "正在验证本机服务可用性…");
        emit_progress(&app, &state);
        verify_runtime_for_preference(source)?;

        state.update("skills", 99, "正在安装精选办事技能…");
        emit_progress(&app, &state);
        match crate::openclaw_skill_bootstrap::bootstrap_curated_skills() {
            Ok(n) if n > 0 => eprintln!("[YunTuAI] provision: installed {n} curated skill(s)"),
            Ok(_) => {}
            Err(e) => eprintln!("[YunTuAI] provision: skill bootstrap skipped: {e}"),
        }

        match crate::openclaw_workspace_bootstrap::bootstrap_workspace_personality() {
            Ok(true) => eprintln!("[YunTuAI] provision: installed default SOUL.md"),
            Ok(false) => {}
            Err(e) => eprintln!("[YunTuAI] provision: personality bootstrap skipped: {e}"),
        }

        match crate::openclaw_workspace_bootstrap::bootstrap_loop_engineering() {
            Ok(true) => eprintln!("[YunTuAI] provision: installed loop engineering (HEARTBEAT/IMPROVEMENTS)"),
            Ok(false) => {}
            Err(e) => eprintln!("[YunTuAI] provision: loop engineering skipped: {e}"),
        }

        Ok(())
    }))
    .unwrap_or_else(|panic| {
        let msg = if let Some(s) = panic.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic.downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        Err(format!("本机服务安装线程异常: {msg}"))
    });

    match result {
        Ok(()) => {
            state.mark_done();
            emit_progress(&app, &state);
        }
        Err(e) => {
            state.set_error(e.clone());
            emit_progress(&app, &state);
            eprintln!("[YunTuAI] OpenClaw provision failed: {e}");
        }
    }

    state.start_guard.store(false, Ordering::SeqCst);
}

pub fn start_provision_async(
    app: AppHandle,
    state: OpenClawProvisionState,
    source: Option<RuntimeSource>,
    stop_external: bool,
) {
    let chosen = source
        .map(coerce_bundled_source)
        .or_else(|| openclaw_runtime::load_runtime_preference().ok().flatten())
        .map(coerce_bundled_source)
        .unwrap_or(RuntimeSource::Bundled);

    if state
        .start_guard
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    {
        let g = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.running {
            state.start_guard.store(false, Ordering::SeqCst);
            return;
        }
        if g.done && openclaw_runtime::runtime_available_for(chosen) {
            state.start_guard.store(false, Ordering::SeqCst);
            return;
        }
    }

    let state_for_err = state.clone();
    match thread::Builder::new()
        .name("yuntuai-openclaw-provision".into())
        .spawn(move || run_provision_pipeline(state, app, chosen, stop_external))
    {
        Ok(handle) => {
            crate::gateway_supervisor::register_daemon_handle(handle);
        }
        Err(e) => {
            state_for_err.start_guard.store(false, Ordering::SeqCst);
            state_for_err.set_error(format!("无法启动安装线程: {e}"));
        }
    }
}

#[tauri::command]
pub fn openclaw_provision_status(state: State<'_, OpenClawProvisionState>) -> ProvisionSnapshot {
    state.snapshot()
}

#[tauri::command]
pub fn openclaw_provision_start(
    app: AppHandle,
    state: State<'_, OpenClawProvisionState>,
    db: State<'_, DbState>,
    token: Option<String>,
    source: Option<String>,
) -> Result<(), String> {
    crate::license::assert_licensed()?;

    {
        let g = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.running {
            return Ok(());
        }
    }

    {
        let mut last = LAST_PROVISION_START_AT
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(at) = *last {
            let wait = PROVISION_START_COOLDOWN.saturating_sub(at.elapsed());
            if !wait.is_zero() {
                return Err(format!(
                    "安装任务启动过于频繁，请 {} 秒后再试",
                    wait.as_secs().max(1)
                ));
            }
        }
        *last = Some(Instant::now());
    }

    // 已登录：完整鉴权后允许 stop_all；预登录（首启）允许安装，但不允许 blast stop_all。
    let authenticated = match token.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => {
            assert_authenticated(&db, t)?;
            true
        }
        None => false,
    };

    let parsed = if let Some(ref s) = source {
        let p = RuntimeSource::from_str_loose(s)
            .ok_or_else(|| "无效的运行时来源".to_string())?;
        if !matches!(p, RuntimeSource::Bundled) {
            return Err("YunTuAI 仅使用内置本机服务".to_string());
        }
        openclaw_runtime::save_runtime_preference(RuntimeSource::Bundled)?;
        Some(RuntimeSource::Bundled)
    } else {
        openclaw_runtime::load_runtime_preference().ok().flatten()
    };
    let parsed = parsed.map(coerce_bundled_source).unwrap_or(RuntimeSource::Bundled);

    let stop_external = source.is_some() && authenticated;
    if source.is_some() && !authenticated {
        eprintln!(
            "[YunTuAI] provision_start: pre-login skip stop_all_gateways (OCR/install path)"
        );
    }

    {
        let mut g = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.running {
            return Ok(());
        }
        g.error = None;
        g.done = false;
        g.phase.clear();
        g.message.clear();
    }
    start_provision_async(app, (*state).clone(), Some(parsed), stop_external);
    Ok(())
}

#[tauri::command]
pub fn openclaw_runtime_set(
    db: State<'_, DbState>,
    token: Option<String>,
    source: String,
) -> Result<(), String> {
    crate::license::assert_licensed()?;
    if let Some(t) = token {
        if !t.trim().is_empty() {
            assert_authenticated(&db, &t)?;
        }
    }
    let parsed = RuntimeSource::from_str_loose(&source)
        .ok_or_else(|| "无效的运行时来源".to_string())?;
    if !matches!(parsed, RuntimeSource::Bundled) {
        return Err("YunTuAI 仅使用内置本机服务".to_string());
    }
    openclaw_runtime::save_runtime_preference(RuntimeSource::Bundled)
}

fn runtime_unavailable_message(_source: RuntimeSource) -> &'static str {
    "内置本机服务未就绪。请等待安装完成或重新安装 YunTuAI。"
}

/// 重新安装/修复内置本机服务运行时。
#[tauri::command]
pub fn openclaw_runtime_switch(
    app: AppHandle,
    sup: State<'_, GatewaySupervisor>,
    db: State<'_, DbState>,
    state: State<'_, OpenClawProvisionState>,
    token: String,
    source: String,
) -> Result<(), String> {
    assert_authenticated(&db, &token)?;
    let parsed = RuntimeSource::from_str_loose(&source)
        .ok_or_else(|| "无效的运行时来源".to_string())?;
    if !matches!(parsed, RuntimeSource::Bundled) {
        return Err("YunTuAI 仅使用内置本机服务".to_string());
    }
    let parsed = RuntimeSource::Bundled;

    if !openclaw_runtime::runtime_available_for(parsed) && !can_provision_for(parsed) {
        return Err(runtime_unavailable_message(parsed).into());
    }

    let current = openclaw_runtime::load_runtime_preference().ok().flatten();
    if current != Some(parsed) {
        let _ = sup.stop(&db);
        stop_all_gateways();
        openclaw_runtime::save_runtime_preference(parsed)?;
        let _ = crate::openclaw_control::repair_openclaw_config_openclaw_compat();
    }

    {
        let mut g = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.running {
            return Ok(());
        }
        g.error = None;
        g.done = false;
        g.phase.clear();
        g.message.clear();
    }
    start_provision_async(app, (*state).clone(), Some(parsed), false);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn verify_download_sha256_skips_when_expected_empty() {
        let path = std::env::temp_dir().join(format!("yuntu-sha-empty-{}", std::process::id()));
        fs::write(&path, b"hello").expect("write temp");
        assert!(verify_download_sha256(&path, "").is_ok());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn verify_download_sha256_matches_hex() {
        let path = std::env::temp_dir().join(format!("yuntu-sha-ok-{}", std::process::id()));
        fs::write(&path, b"hello").expect("write temp");
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_download_sha256(&path, expected).is_ok());
        assert!(verify_download_sha256(&path, "deadbeef").is_err());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn dir_cleanup_guard_removes_on_drop() {
        let path = std::env::temp_dir().join(format!("yuntu-guard-drop-{}", std::process::id()));
        fs::create_dir_all(&path).expect("create dir");
        let guard = DirCleanupGuard::new(path.clone());
        drop(guard);
        assert!(!path.exists());
    }

    #[test]
    fn dir_cleanup_guard_disarm_keeps_dir() {
        let path = std::env::temp_dir().join(format!("yuntu-guard-keep-{}", std::process::id()));
        fs::create_dir_all(&path).expect("create dir");
        let mut guard = DirCleanupGuard::new(path.clone());
        guard.disarm();
        drop(guard);
        assert!(path.is_dir());
        let _ = fs::remove_dir_all(&path);
    }
}
