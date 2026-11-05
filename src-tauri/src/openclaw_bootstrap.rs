//! 首次启动：解压安装包内置的 OpenClaw 便携运行时，并初始化 `openclaw-data` 默认配置。

use crate::paths;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use zip::ZipArchive;

type BootstrapProgress<'a> = &'a mut dyn FnMut(u8, &str);

const PAYLOAD_ZIP: &str = "openclaw-portable-payload.zip";
const VERSION_STAMP: &str = "OPENCLAW_VERSION";
const BUNDLED_OPENCLAW_VERSION: &str = env!("OPENCLAW_RUNTIME_OPENCLAW_VERSION");

/// 源码树中的 bundled 目录（仅开发模式生效）。编译时展开为绝对路径。
#[cfg(debug_assertions)]
const SOURCE_BUNDLED_DIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/bundled/openclaw-portable");

fn portable_dir() -> Result<PathBuf, String> {
    Ok(paths::installed_dir()?.join("openclaw-portable"))
}

/// 读取便携目录中的版本戳，记录上次解压/安装的 OPENCLAW 版本。
fn read_portable_version() -> Option<String> {
    let dir = portable_dir().ok()?;
    let stamp = dir.join(VERSION_STAMP);
    if !stamp.is_file() {
        return None;
    }
    fs::read_to_string(&stamp).ok().map(|s| s.trim().to_string())
}

/// 写入版本戳，标记当前便携目录对应的版本。
pub(crate) fn write_portable_version() {
    if let Ok(dir) = portable_dir() {
        let stamp = dir.join(VERSION_STAMP);
        let _ = fs::write(&stamp, BUNDLED_OPENCLAW_VERSION);
    }
}

/// 便携运行时是否可用（文件就绪且版本匹配）。
fn portable_ready(dir: &Path) -> bool {
    crate::openclaw_platform::portable_runtime_ready(dir)
}

pub(crate) fn openclaw_runtime_ready() -> bool {
    portable_dir()
        .map(|d| portable_ready(&d))
        .unwrap_or(false)
}

/// 检查便携目录是否需要更新：文件就绪但版本戳不匹配。
#[allow(dead_code)]
pub(crate) fn portable_version_mismatch() -> bool {
    let Ok(dir) = portable_dir() else { return false };
    if !portable_ready(&dir) {
        return false;
    }
    match read_portable_version() {
        Some(v) => v != BUNDLED_OPENCLAW_VERSION,
        None => true, // 无版本戳 = 旧版
    }
}

pub(crate) fn has_bundled_payload_zip() -> bool {
    portable_dir()
        .map(|d| d.join(PAYLOAD_ZIP).is_file())
        .unwrap_or(false)
}

const OPENCLAW_CMD: &str = include_str!("../bundled/openclaw-portable/openclaw.cmd");
const OPENCLAW_SH: &str = include_str!("../bundled/openclaw-portable/openclaw.sh");

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path)
        .map_err(|e| e.to_string())?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

pub(crate) fn ensure_openclaw_cmd() -> Result<(), String> {
    let dir = portable_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let launcher = crate::openclaw_platform::openclaw_launcher_name();
    let cmd_path = dir.join(launcher);
    if !cmd_path.is_file() {
        let body = if cfg!(target_os = "windows") {
            OPENCLAW_CMD
        } else {
            OPENCLAW_SH
        };
        fs::write(&cmd_path, body).map_err(|e| format!("写入 {launcher}: {e}"))?;
        #[cfg(unix)]
        make_executable(&cmd_path)?;
    }
    Ok(())
}

fn extract_portable_payload(
    zip_path: &Path,
    dest: &Path,
    mut progress: Option<BootstrapProgress<'_>>,
) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("无法打开 {zip_path:?}: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("无法读取压缩包: {e}"))?;
    let total = archive.len().max(1);

    let mut created_dirs: HashSet<PathBuf> = HashSet::new();

    // 预创建目标根目录
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    // 批量创建所有目录（一次性 mkdir 减少系统调用）
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            if let Some(rel) = entry.enclosed_name() {
                if entry.is_dir() {
                    let out = dest.join(&rel);
                    if created_dirs.insert(out.clone()) {
                        fs::create_dir_all(&out).map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }

    let mut last_pct = 15u8;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };
        let out = dest.join(&rel);
        if entry.is_dir() {
            // 目录已在前一步创建
            continue;
        }
        if let Some(parent) = out.parent() {
            if created_dirs.insert(parent.to_path_buf()) {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        let mut out_file = File::create(&out).map_err(|e| format!("写入 {out:?}: {e}"))?;
        io::copy(&mut entry, &mut out_file)
            .map_err(|e| format!("解压 {rel:?}: {e}"))?;

        // 降低进度回调频率：仅在百分比变化时报告，减少 IPC 开销
        if let Some(ref mut report) = progress {
            let pct = 15u8.saturating_add(((i + 1) as u64 * 70 / total as u64) as u8);
            if pct > last_pct {
                last_pct = pct;
                report(pct.min(85), &format!("正在解压本机服务运行时… {}/{}", i + 1, total));
            }
        }
    }
    if let Some(ref mut report) = progress {
        report(85, "本机服务运行时解压完成");
    }
    Ok(())
}

/// 解压 MSI 内置 zip（由 provision UI 调用，startup 不阻塞解压）。
pub(crate) fn ensure_openclaw_portable_runtime(
    progress: Option<BootstrapProgress<'_>>,
) -> Result<(), String> {
    let dir = portable_dir()?;
    if portable_ready(&dir) && !portable_version_mismatch() {
        return Ok(());
    }

    if portable_ready(&dir) && portable_version_mismatch() {
        eprintln!(
            "[YunTuAI] OpenClaw runtime version mismatch (stamp={:?}, bundled={}), re-extracting…",
            read_portable_version(),
            BUNDLED_OPENCLAW_VERSION
        );
        for sub in ["node-runtime", "npm-prefix"] {
            let p = dir.join(sub);
            if p.exists() {
                let _ = fs::remove_dir_all(&p);
            }
        }
        let stamp = dir.join(VERSION_STAMP);
        if stamp.is_file() {
            let _ = fs::remove_file(&stamp);
        }
    }

    let zip_path = dir.join(PAYLOAD_ZIP);
    if !zip_path.is_file() {
        if cfg!(debug_assertions) {
            return Ok(());
        }
        return Err(
            "安装不完整：缺少本机服务运行时包。请重新安装 YunTuAI 或等待在线下载。".into(),
        );
    }

    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    extract_portable_payload(&zip_path, &dir, progress)?;

    if !portable_ready(&dir) {
        return Err("本机服务运行时解压后校验失败，请重新安装。".into());
    }
    let npm_prefix = dir.join("npm-prefix");
    let _ = crate::openclaw_relay_waf_patch::patch_openclaw_npm_prefix_for_relay_waf(&npm_prefix);
    ensure_openclaw_cmd()?;
    write_portable_version();
    Ok(())
}

fn new_gateway_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// 安装目录下 `openclaw-data` 无配置时写入最小可用模板（含网关 token）。
pub(crate) fn seed_openclaw_data_defaults() -> Result<(), String> {
    let data_dir = paths::openclaw_data_dir()?;
    let cfg_path = data_dir.join("openclaw.json");
    let env_path = data_dir.join(".env");

    if !env_path.exists() {
        let token = new_gateway_token();
        let env_body = crate::distribution_policy::seed_env_body(&token);
        fs::write(&env_path, env_body).map_err(|e| format!("写入 .env: {e}"))?;
    } else {
        let _ = crate::openclaw_env::ensure_embedded_relay_api_key_on_disk();
    }

    if cfg_path.exists() {
        return Ok(());
    }

    let workspace = data_dir.join("workspace");
    fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
    let wp = workspace.to_string_lossy().to_string();

    let config = crate::distribution_policy::seed_openclaw_json(&wp);

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("生成 openclaw.json 失败: {e}"))?;

    fs::write(&cfg_path, json).map_err(|e| format!("写入服务配置文件: {e}"))?;

    if let Err(e) = crate::openclaw_workspace_bootstrap::bootstrap_workspace_personality() {
        eprintln!("[YunTuAI] 人格模板写入跳过: {e}");
    }
    if let Err(e) = crate::openclaw_workspace_bootstrap::bootstrap_loop_engineering() {
        eprintln!("[YunTuAI] 循环工程写入跳过: {e}");
    }
    Ok(())
}

/// 应用 setup 阶段：仅写入 openclaw.cmd / 种子配置；解压与下载交给 provision UI。
/// 开发模式下将源码树 bundled 中的 zip 复制到 AppData 目录下，
/// 以便 ensure_openclaw_portable_runtime 能找到并解压。
#[cfg(debug_assertions)]
fn seed_dev_portable_zip() -> Result<(), String> {
    let dest_dir = portable_dir()?;
    let dest = dest_dir.join(PAYLOAD_ZIP);
    if dest.is_file() {
        return Ok(());
    }
    let src = Path::new(SOURCE_BUNDLED_DIR).join(PAYLOAD_ZIP);
    if !src.is_file() {
        // dev 模式下若源码树中也找不到，跳过（可能是测试环境），production 路径会处理
        return Ok(());
    }
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    fs::copy(&src, &dest).map_err(|e| format!("复制运行时 zip: {e}"))?;
    Ok(())
}

pub(crate) fn bootstrap_openclaw_on_startup() -> Result<(), String> {
    let profile = crate::distribution_policy::active_distribution_profile();
    eprintln!(
        "[YunTuAI] distribution={} product={}",
        profile.id(),
        profile.product_version()
    );
    // 0) 修复损坏的 .env 格式（注释行内误拼接密钥）
    let _ = crate::openclaw_env::normalize_dotenv_file();
    // 0b) 去除 JSON 文件 UTF-8 BOM（手工 PowerShell 编辑后偶发）
    let _ = crate::openclaw_env::normalize_json_bom_files();
    // 1) 写入 openclaw.cmd（轻量操作）
    let _ = ensure_openclaw_cmd();
    // 2) dev 模式下把源码树 bundled 中的 zip 复制到 AppData，以使解压逻辑正常工作
    #[cfg(debug_assertions)]
    let _ = seed_dev_portable_zip();
    // 3) 创建默认配置（.env / openclaw.json），若无配置则写入最小可用模板
    seed_openclaw_data_defaults()?;
    if let Err(e) = crate::openclaw_workspace_bootstrap::bootstrap_workspace_personality() {
        eprintln!("[YunTuAI] bootstrap: personality skipped: {e}");
    }
    if let Err(e) = crate::openclaw_workspace_bootstrap::bootstrap_loop_engineering() {
        eprintln!("[YunTuAI] bootstrap: loop engineering skipped: {e}");
    }
    // 3b) 中转站发行包：确保内嵌 API Key 已写入磁盘（升级/修复场景）
    let _ = crate::openclaw_env::ensure_embedded_relay_api_key_on_disk();
    // 3c) 安装包 MSI 预解压运行时时补写版本戳，避免首次启动误判需重新解压
    if openclaw_runtime_ready() && read_portable_version().is_none() {
        write_portable_version();
    }
    // 4) 版本戳检查：运行时已就绪且版本匹配时记录日志（不匹配时由 provision 重新解压）
    if openclaw_runtime_ready() {
        let stamp_ver = read_portable_version();
        if stamp_ver.as_deref() == Some(BUNDLED_OPENCLAW_VERSION) {
            eprintln!("[YunTuAI] bootstrap: bundled OpenClaw {} ready", BUNDLED_OPENCLAW_VERSION);
        } else {
            eprintln!(
                "[YunTuAI] bootstrap: OpenClaw runtime stamp mismatch (stamp={:?}, bundled={}); provision will re-extract if needed",
                stamp_ver,
                BUNDLED_OPENCLAW_VERSION
            );
        }
    }
    // ZIP 解压推迟到用户选择内置运行时后由 provision UI 执行，避免 setup() 阶段长时间阻塞。
    Ok(())
}
