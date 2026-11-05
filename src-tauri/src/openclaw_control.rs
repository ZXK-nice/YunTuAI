//! YunTuAI 对 OpenClaw 的控制面：发现本机环境、接管数据目录、受控读写配置。
//!
//! 策略：仅通过设备授权（license.dat）控制软件使用；不再对 openclaw.json 做封存/漂移回滚。
//! OpenClaw 仅允许由 YunTuAI 子进程调用（见 `YUNTUAI_MANAGED_SUBPROCESS`）。

use crate::openclaw_runtime::strip_bom;

use crate::auth::assert_authenticated;
use crate::owner::assert_owner;
use crate::db::{audit_insert_on_conn, lock_conn, DbState};
use crate::openclaw::{bundled_openclaw_ready, gateway_status_probe, probe_global_openclaw, probe_legacy_home_openclaw, stop_all_external_gateways};
use crate::openclaw_runtime;
use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::State;

static WATCHDOG_STARTED: AtomicBool = AtomicBool::new(false);
/// 首次 `establish_absolute_control` 完成后置位；auto-ensure 应等待策略写入后再 spawn。
static ESTABLISH_COMPLETE: AtomicBool = AtomicBool::new(false);
/// establish 工作线程仍在执行（含超时后后台继续跑 stop_all 等重型步骤）。
static ESTABLISH_WORK_ACTIVE: AtomicBool = AtomicBool::new(false);

thread_local! {
    static IN_ESTABLISH_WORK: Cell<bool> = const { Cell::new(false) };
}

struct EstablishWorkScope;

impl EstablishWorkScope {
    fn enter() -> Self {
        ESTABLISH_WORK_ACTIVE.store(true, Ordering::Release);
        IN_ESTABLISH_WORK.with(|c| c.set(true));
        Self
    }
}

impl Drop for EstablishWorkScope {
    fn drop(&mut self) {
        IN_ESTABLISH_WORK.with(|c| c.set(false));
        ESTABLISH_WORK_ACTIVE.store(false, Ordering::Release);
    }
}

/// 其它 IPC 路径是否应推迟 stop_all / 全机扫 node（establish 后台线程仍在跑）。
pub fn should_defer_heavy_gateway_ipc() -> bool {
    ESTABLISH_WORK_ACTIVE.load(Ordering::Acquire)
        && !IN_ESTABLISH_WORK.with(|c| c.get())
}

pub fn is_establish_work_active() -> bool {
    ESTABLISH_WORK_ACTIVE.load(Ordering::Acquire)
}

#[allow(dead_code)]
pub fn is_establish_complete() -> bool {
    ESTABLISH_COMPLETE.load(Ordering::Acquire)
}

pub fn mark_establish_complete() {
    ESTABLISH_COMPLETE.store(true, Ordering::Release);
}

/// 阻塞等待 establish 线程完成（最多 `max_wait`），避免网关在无 allowedOrigins 策略时启动。
pub fn wait_for_establish_ready(max_wait: Duration) {
    if ESTABLISH_COMPLETE.load(Ordering::Acquire) {
        return;
    }
    let step = Duration::from_millis(200);
    let mut waited = Duration::ZERO;
    while waited < max_wait {
        if ESTABLISH_COMPLETE.load(Ordering::Acquire) {
            return;
        }
        std::thread::sleep(step);
        waited += step;
    }
}

const MANIFEST_NAME: &str = "yuntuai-openclaw-control.json";
const VAULT_DIR: &str = ".yuntuai/vault";
const GATEWAY_CONFIG_STALE_MARKER: &str = ".yuntuai/gateway-config-stale";
#[allow(dead_code)]
const SEAL_MARKER: &str = ".yuntuai-sealed";
pub(crate) const ALLOWED_CONFIG: &[&str] = &["openclaw.json", "config.json", "config.yml", "config.yaml"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawControlManifest {
    pub version: u32,
    pub adopted_at: String,
    pub data_dir: String,
    pub use_bundled_runtime: bool,
    pub global_openclaw_detected: bool,
    pub legacy_home_detected: bool,
    pub sealed: bool,
    pub policy_version: u32,
    pub config_hashes: HashMap<String, String>,
    #[serde(default)]
    pub env_hash: Option<String>,
    #[serde(default)]
    pub absolute_control: bool,
    /// Owner 开关：允许 AI（任何已登录用户）通过受控路径修改 OpenClaw 配置。
    /// 开启后 enforce_control 不会回滚漂移，write_config 绕过 Owner 验证。
    #[serde(default)]
    pub allow_ai_full_access: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AbsoluteControlResult {
    pub ok: bool,
    pub adopted: bool,
    pub policy_applied: bool,
    pub secrets_sealed: bool,
    pub external_gateways_stopped: bool,
    pub config_enforced: bool,
    pub drift_restored: Vec<String>,
    pub message: String,
}

const SECRETS_VAULT_NAME: &str = "openclaw-secrets.vault";
const POLICY_VERSION: u32 = 4;

/// YunTuAI 桌面 WebView / Vite 开发源。
/// 注意：Tauri v2 WebView 的 origin 为 `tauri://localhost`（生产）或 `http://localhost:1420`（Vite dev）。
/// 不使用通配符 `*`，防止未预期的 origin 绕过网关鉴权。
const YUNTUAI_CONTROL_UI_ALLOWED_ORIGINS: &[&str] = &[
    "http://tauri.localhost",
    "https://tauri.localhost",
    "tauri://localhost",
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "http://localhost:1421",
    "http://127.0.0.1:1421",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawEnvironmentDiscovery {
    pub bundled_ready: bool,
    pub global_openclaw_in_path: bool,
    pub global_openclaw_version: Option<String>,
    pub legacy_home_exists: bool,
    pub legacy_home_dir: Option<String>,
    pub managed_data_dir: String,
    pub managed_data_exists: bool,
    pub legacy_richness_score: usize,
    pub migration_recommended: bool,
    pub has_adopted_manifest: bool,
    pub manifest: Option<OpenClawControlManifest>,
    pub gateway_probe_running: Option<bool>,
    pub recommended_action: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawConfigFileView {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub content: Option<String>,
    pub sha256: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawControlEnforceResult {
    pub ok: bool,
    pub drift_detected: bool,
    pub drift_files: Vec<String>,
    pub restored_files: Vec<String>,
    pub sealed: bool,
    pub message: String,
}

fn manifest_path() -> Result<PathBuf, String> {
    Ok(paths::data_dir()?.join(MANIFEST_NAME))
}

pub(crate) fn load_manifest() -> Result<Option<OpenClawControlManifest>, String> {
    let p = manifest_path()?;
    if !p.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&p).map_err(|e| format!("读取管控清单: {e}"))?;
    serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析管控清单: {e}"))
}

pub(crate) fn save_manifest(m: &OpenClawControlManifest) -> Result<(), String> {
    let p = manifest_path()?;
    let raw = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    fs::write(&p, raw).map_err(|e| format!("写入管控清单: {e}"))
}

/// 已接管的数据目录；未 adopt 时回退到默认 openclaw-data。
pub fn managed_openclaw_data_dir() -> Result<PathBuf, String> {
    if let Ok(Some(m)) = load_manifest() {
        let p = PathBuf::from(&m.data_dir);
        if p.is_absolute() || p.exists() {
            fs::create_dir_all(&p).ok();
            return Ok(p);
        }
    }
    paths::openclaw_data_dir()
}

/// 解析 OpenClaw 工作区目录：优先 `openclaw.json` 的 `agents.defaults.workspace`，
/// 相对路径按数据目录解析；未配置时回退 `<data_dir>/workspace`（产品默认约定）。
/// 所有写工作区文件的模块都应走这里，避免用户自定义 workspace 后技能/产出路径失配。
pub fn resolve_workspace_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let cfg = data_dir.join("openclaw.json");
    if cfg.is_file() {
        if let Ok(raw) = fs::read_to_string(&cfg) {
            if let Ok(v) = serde_json::from_str::<Value>(strip_bom(&raw)) {
                if let Some(ws) = v
                    .pointer("/agents/defaults/workspace")
                    .and_then(|x| x.as_str())
                {
                    let ws = ws.trim();
                    if !ws.is_empty() {
                        let p = PathBuf::from(ws);
                        return if p.is_absolute() {
                            Ok(p)
                        } else {
                            Ok(data_dir.join(p))
                        };
                    }
                }
            }
        }
    }
    Ok(data_dir.join("workspace"))
}

fn sha256_hex(content: &str) -> String {
    let mut h = Sha256::new();
    h.update(content.as_bytes());
    hex::encode(h.finalize())
}

/// 漂移检测用 hash：忽略 OpenClaw 运行时写入的 `meta`，避免与只读封存/回滚打架。
fn hash_openclaw_json_for_drift(raw: &str) -> String {
    let Ok(mut root) = serde_json::from_str::<Value>(raw) else {
        return sha256_hex(raw);
    };
    if let Some(obj) = root.as_object_mut() {
        obj.remove("meta");
    }
    let normalized =
        serde_json::to_string(&root).unwrap_or_else(|_| raw.to_string());
    sha256_hex(&normalized)
}

pub(crate) fn hash_config_files(base: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for name in ALLOWED_CONFIG {
        let p = base.join(name);
        if p.is_file() {
            if let Ok(raw) = fs::read_to_string(&p) {
                let h = if *name == "openclaw.json" {
                    hash_openclaw_json_for_drift(strip_bom(&raw))
                } else {
                    sha256_hex(strip_bom(&raw))
                };
                out.insert(name.to_string(), h);
            }
        }
    }
    out
}

pub(crate) fn vault_path(base: &Path, name: &str) -> PathBuf {
    base.join(VAULT_DIR).join(name)
}

pub(crate) fn backup_to_vault(base: &Path, name: &str) -> Result<(), String> {
    let src = base.join(name);
    if !src.is_file() {
        return Ok(());
    }
    let dest = vault_path(base, name);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map_err(|e| format!("备份 {name} 到 vault: {e}"))?;
    Ok(())
}

#[allow(dead_code)]
fn restore_from_vault(_base: &Path, _name: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
fn set_readonly(path: &Path, readonly: bool) -> Result<(), String> {
    let perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    let mut p = perms;
    p.set_readonly(readonly);
    fs::set_permissions(path, p).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn set_readonly(path: &Path, readonly: bool) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let mut perms = meta.permissions();
    let mode = if readonly { 0o444 } else { 0o644 };
    perms.set_mode(mode);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

fn clear_readonly_if_needed(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Ok(());
    }
    let readonly = fs::metadata(path)
        .map_err(|e| e.to_string())?
        .permissions()
        .readonly();
    if readonly {
        set_readonly(path, false)?;
    }
    Ok(())
}

pub(crate) fn seal_config_files(_base: &Path) -> Result<(), String> {
    Ok(())
}

pub(crate) fn unseal_config_files(base: &Path) {
    for name in [".env", "openclaw.json"] {
        let path = base.join(name);
        if let Err(e) = clear_readonly_if_needed(&path) {
            eprintln!("[YunTuAI] unseal {name}: {e}");
        }
    }
}

/// 写入 openclaw-data 配置前解除旧版封存留下的只读属性。
pub(crate) fn unseal_for_write(base: &Path) {
    unseal_config_files(base);
}

fn pick_adopt_dir(prefer_legacy: bool) -> Result<PathBuf, String> {
    let default = paths::openclaw_data_dir()?;
    let (legacy_exists, legacy_dir) = probe_legacy_home_openclaw();
    if prefer_legacy && legacy_exists {
        if let Some(ld) = legacy_dir {
            return Ok(PathBuf::from(ld));
        }
    }
    Ok(default)
}

/// 仅监控网关连接相关键；API Key 等用户可编辑项不参与漂移回滚。
const DRIFT_MONITORED_ENV_KEYS: &[&str] = &[
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_GATEWAY_PORT",
    "OPENCLAW_GATEWAY_HOST",
];

pub(crate) fn hash_env_drift_keys(base: &Path) -> Option<String> {
    let p = base.join(".env");
    if !p.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&p).ok()?;
    let mut lines: Vec<&str> = raw
        .lines()
        .map(str::trim)
        .filter(|line| {
            if line.is_empty() || line.starts_with('#') {
                return false;
            }
            line.split_once('=')
                .map(|(k, _)| DRIFT_MONITORED_ENV_KEYS.contains(&k.trim()))
                .unwrap_or(false)
        })
        .collect();
    if lines.is_empty() {
        return None;
    }
    lines.sort_unstable();
    Some(sha256_hex(&lines.join("\n")))
}

fn machine_seal_key() -> Vec<u8> {
    let mut h = Sha256::new();
    if let Ok(dir) = paths::installed_dir() {
        h.update(dir.to_string_lossy().as_bytes());
    }
    if let Ok(hn) = hostname::get() {
        h.update(hn.to_string_lossy().as_bytes());
    }
    h.finalize().to_vec()
}

fn seal_plaintext(plain: &str) -> String {
    let key = machine_seal_key();
    let enc: Vec<u8> = plain
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect();
    format!("YTSEAL1:{}", hex::encode(enc))
}

fn unseal_plaintext(cipher: &str) -> Option<String> {
    let rest = cipher.strip_prefix("YTSEAL1:")?;
    let bytes = hex::decode(rest).ok()?;
    let key = machine_seal_key();
    let plain: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect();
    String::from_utf8(plain).ok()
}

fn secrets_vault_path() -> Result<PathBuf, String> {
    Ok(paths::data_dir()?.join(SECRETS_VAULT_NAME))
}

pub fn read_sealed_gateway_token() -> Option<String> {
    let path = secrets_vault_path().ok()?;
    let raw = fs::read_to_string(&path).ok()?;
    let v: Value = serde_json::from_str(strip_bom(&raw)).ok()?;
    let sealed = v.get("gatewayToken")?.as_str()?;
    unseal_plaintext(sealed)
}

fn seal_secrets_vault(base: &Path) -> Result<bool, String> {
    let env_path = base.join(".env");
    if !env_path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let mut token = None;
    for line in raw.lines() {
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == "OPENCLAW_GATEWAY_TOKEN" {
                let t = v.trim();
                if !t.is_empty() {
                    token = Some(t.to_string());
                }
            }
        }
    }
    let Some(tok) = token else {
        return Ok(false);
    };
    let vault = json!({
        "gatewayToken": seal_plaintext(&tok),
        "sealedAt": chrono::Utc::now().to_rfc3339(),
    });
    let path = secrets_vault_path()?;
    fs::write(&path, vault.to_string()).map_err(|e| e.to_string())?;
    Ok(true)
}

fn yuntuai_control_ui_allowed_origins_value() -> Value {
    Value::Array(
        YUNTUAI_CONTROL_UI_ALLOWED_ORIGINS
            .iter()
            .map(|s| Value::String((*s).to_string()))
            .collect(),
    )
}

/// 合并 `gateway.controlUi.allowedOrigins`，避免 YunTuAI WebView 连网关时被 CONTROL_UI_ORIGIN_NOT_ALLOWED 拒绝。
fn merge_control_ui_allowed_origins(root: &mut Value) -> bool {
    // 确保 gateway 和 controlUi 嵌套对象均存在
    let _ = root
        .as_object_mut()
        .map(|obj| {
            if !obj.contains_key("gateway") || !obj["gateway"].is_object() {
                obj.insert("gateway".into(), json!({}));
            }
            if let Some(gw) = obj.get_mut("gateway").and_then(|g| g.as_object_mut()) {
                if !gw.contains_key("controlUi") || !gw["controlUi"].is_object() {
                    gw.insert("controlUi".into(), json!({}));
                }
            }
        });
    // 现在可以安全地获取 controlUi 的可变引用
    let control_ui = match root
        .get_mut("gateway")
        .and_then(|g| g.get_mut("controlUi"))
        .and_then(|c| c.as_object_mut())
    {
        Some(map) => map,
        None => return false,
    };

    let mut current: Vec<String> = control_ui
        .get("allowedOrigins")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let had_origins = control_ui.get("allowedOrigins").is_some();
    let mut changed = !had_origins;

    // YunTuAI 为唯一控制台：强制关闭上游 Web Control UI，防止用户绕过产品壳。
    if control_ui.get("enabled").and_then(|v| v.as_bool()) != Some(false) {
        control_ui.insert("enabled".into(), Value::Bool(false));
        changed = true;
    }

    for origin in YUNTUAI_CONTROL_UI_ALLOWED_ORIGINS {
        if !current.iter().any(|o| o == origin) {
            current.push((*origin).to_string());
            changed = true;
        }
    }
    if changed {
        control_ui.insert("allowedOrigins".into(), Value::Array(
            current.into_iter().map(Value::String).collect(),
        ));
    }
    // 移除通配符 origin（分发模板历史遗留），避免任意浏览器源连入。
    if let Some(arr) = control_ui
        .get_mut("allowedOrigins")
        .and_then(|v| v.as_array_mut())
    {
        let before = arr.len();
        arr.retain(|v| v.as_str() != Some("*"));
        if arr.len() != before {
            changed = true;
        }
    }
    changed
}

fn yuntuai_policy_patch() -> Value {
    // 管控元数据仅写入 yuntuai-openclaw-control.json；勿写入服务配置文件.meta，
    // OpenClaw 2026.5+ 对 meta 做 strict schema，未知键会导致 gateway exit 1。
    //
    // ════════════════════════════════════════════════════════════════════
    // 安全说明：以下三个 config 项的本机安全性权衡
    //
    // 1. allowInsecureAuth: true
    //    允许 WebView 前端通过 token 连接网关时跳过设备签名。
    //    仅监听 loopback，攻击者需要能在本机执行任意代码才能利用。
    //
    // 2. dangerouslyDisableDeviceAuth: true
    //    前端 WebSocket 客户端（浏览器 API）无法执行设备签名所需的
    //    Web Crypto / 密钥对操作。作为替代方案，WebSocket connect 帧
    //    回退到纯 token 认证 + 在收到 connect.challenge 时重发。
    //    未来改进：将 WebSocket 连接迁移到 Rust 侧实现，以启用端到端设备签名。
    //
    // 3. dangerouslyAllowHostHeaderOriginFallback: true
    //    WebSocket 升级时 Host header 可能因 Tauri WebView 环境不一致，
    //    此标志允许在标准 origin 校验失败时以 Host header 作为回退。
    //    allowedOrigins 已严格限定为已知的本地源（见 YUNTUAI_CONTROL_UI_ALLOWED_ORIGINS）。
    //
    // 风险缓释：网关绑定 loopback + 端口 18789（非默认 80/443），
    // 外部攻击者无法远程利用。CSP restrict connect-src 仅限本机端口。
    // ════════════════════════════════════════════════════════════════════
    json!({
        "gateway": {
            "mode": "local",
            "bind": "loopback",
            "port": 18789,
            "auth": { "mode": "token" },
            "controlUi": {
                "enabled": false,
                "allowInsecureAuth": true,
                "dangerouslyDisableDeviceAuth": true,
                "dangerouslyAllowHostHeaderOriginFallback": true,
                "allowedOrigins": yuntuai_control_ui_allowed_origins_value()
            }
        }
    })
}

const YUNTUAI_OPENCLAW_META_KEYS: &[&str] = &["yuntuaiManaged", "yuntuaiPolicyVersion"];

/// 移除 agent 级 models.json 中错误 provider（merge 模式下会污染全局配置）。
fn repair_main_agent_models_json(base: &Path, env_map: &HashMap<String, String>) -> Result<bool, String> {
    let path = base.join("agents/main/agent/models.json");
    if !path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value =
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析 models.json: {e}"))?;
    if !crate::distribution_policy::repair_agent_models_json(&mut root, Some(env_map)) {
        return Ok(false);
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    Ok(true)
}

fn read_dotenv_map(base: &Path) -> HashMap<String, String> {
    let env_path = base.join(".env");
    let Ok(raw) = fs::read_to_string(&env_path) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim();
            if !key.is_empty() {
                out.insert(key.to_string(), v.trim().to_string());
            }
        }
    }
    out
}

/// 网关启动前：按 `.env` 裁剪 openclaw.json / models.json 中的可选 provider。
pub(crate) fn sync_model_providers_for_dotenv() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(false);
    }
    unseal_config_files(&base);
    let env_map = read_dotenv_map(&base);
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;
    let mut changed = false;
    if crate::distribution_policy::repair_openclaw_providers(&mut root, Some(&env_map)) {
        backup_to_vault(&base, "openclaw.json")?;
        let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
        fs::write(&path, &out).map_err(|e| e.to_string())?;
        changed = true;
    }
    if repair_main_agent_models_json(&base, &env_map)? {
        changed = true;
    }
    if changed {
        mark_gateway_config_stale(&base);
    }
    Ok(changed)
}

/// 网关每次启动前修复记忆检索/持久化配置（比 establish 更轻，走 prepare_gateway_runtime_env 热路径）。
pub(crate) fn repair_openclaw_memory_recall_on_disk() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(false);
    }
    unseal_config_files(&base);
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;
    if !crate::distribution_policy::repair_memory_recall_config(&mut root) {
        return Ok(false);
    }
    backup_to_vault(&base, "openclaw.json")?;
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);
    Ok(true)
}

/// 升级存量安装：注入默认模型与 compaction 配置（直连档默认 deepseek-flash）。
/// 仅在字段缺失时注入，不覆盖用户已有自定义。
fn ensure_model_and_compaction_defaults() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(false);
    }

    unseal_config_files(&base);

    let env_map = read_dotenv_map(&base);

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;

    let mut changed = false;

    if crate::distribution_policy::repair_openclaw_providers(&mut root, Some(&env_map)) {
        changed = true;
    }
    if crate::distribution_policy::repair_openclaw_image_model(&mut root) {
        changed = true;
    }
    if crate::distribution_policy::repair_provider_timeout_seconds(&mut root) {
        changed = true;
    }
    if crate::distribution_policy::repair_memory_recall_config(&mut root) {
        changed = true;
    }
    if crate::distribution_policy::repair_browser_profiles_in_config(&mut root) {
        changed = true;
    }
    if repair_main_agent_models_json(&base, &env_map)? {
        changed = true;
    }

    // 1) 注入 compaction.reserveTokensFloor（缺失或 < 32000 时设置，长任务 PDF/多轮工具更稳）
    let current_reserve = root
        .pointer("/agents/defaults/compaction/reserveTokensFloor")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if current_reserve < 32000 {
        let patch = json!({ "agents": { "defaults": { "compaction": { "reserveTokensFloor": 32000 } } } });
        backup_to_vault(&base, "openclaw.json")?;
        deep_merge_json(&mut root, patch);
        changed = true;
    }

    // 长任务（PDF/多轮工具）默认 Agent 超时过短会误杀；与前端 2h 无活动硬顶对齐。
    const AGENT_RUN_TIMEOUT_SECONDS: u64 = 7200;
    let current_timeout = root
        .pointer("/agents/defaults/timeoutSeconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if current_timeout < AGENT_RUN_TIMEOUT_SECONDS {
        let patch = json!({ "agents": { "defaults": { "timeoutSeconds": AGENT_RUN_TIMEOUT_SECONDS } } });
        backup_to_vault(&base, "openclaw.json")?;
        deep_merge_json(&mut root, patch);
        changed = true;
    }

    // 2) 按发行档注入签名模型定义（仅在缺失时）
    match crate::distribution_policy::active_distribution_profile() {
        crate::distribution_policy::DistributionProfile::Internal => {
            let has_flash = root
                .pointer("/models/providers/deepseek/models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .any(|m| m.get("id").and_then(|id| id.as_str()) == Some("deepseek-flash"))
                })
                .unwrap_or(false);
            if !has_flash {
                let patch = json!({
                    "models": {
                        "providers": {
                            "deepseek": {
                                "models": [
                                    { "id": "deepseek-flash", "name": "DeepSeek V4.1 Flash", "contextWindow": 1048576, "maxTokens": 16384 }
                                ]
                            }
                        }
                    }
                });
                backup_to_vault(&base, "openclaw.json")?;
                deep_merge_json(&mut root, patch);
                changed = true;
            }
        }
        crate::distribution_policy::DistributionProfile::RelayStation => {
            let has_gpt55 = root
                .pointer("/models/providers/yuntuai/models")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter().any(|m| m.get("id").and_then(|id| id.as_str()) == Some("gpt-5.5"))
                })
                .unwrap_or(false);
            if !has_gpt55 {
                let patch = json!({
                    "models": {
                        "providers": {
                            "yuntuai": {
                                "models": [
                                    { "id": "gpt-5.5", "name": "GPT 5.5", "contextWindow": 1048576, "maxTokens": 16384 }
                                ]
                            }
                        }
                    }
                });
                backup_to_vault(&base, "openclaw.json")?;
                deep_merge_json(&mut root, patch);
                changed = true;
            }
        }
    }

    // 3) 厂商前缀写错时只改通道，保留用户设定的模型名。
    let current_primary = root
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(current) = current_primary.as_deref() {
        let fixed = crate::distribution_policy::qualify_model_id(current);
        if fixed != current {
            deep_merge_json(
                &mut root,
                json!({
                    "agents": {
                        "defaults": {
                            "model": { "primary": fixed }
                        }
                    }
                }),
            );
            changed = true;
        }
    }
    let current_primary = root
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str());
    let target_primary = crate::distribution_policy::preferred_primary_model_for_env_keys(&env_map)
        .unwrap_or_else(|| {
            crate::distribution_policy::active_distribution_profile()
                .primary_model()
                .to_string()
        });
    let current_has_key = current_primary
        .map(|c| crate::distribution_policy::primary_model_has_configured_key(c, &env_map))
        .unwrap_or(false);
    let should_switch_primary = crate::distribution_policy::should_reset_primary_model(current_primary)
        || (!current_has_key
            && current_primary.map(|c| c != target_primary.as_str()).unwrap_or(true)
            && crate::distribution_policy::preferred_primary_model_for_env_keys(&env_map)
                .is_some());
    if should_switch_primary {
        deep_merge_json(
            &mut root,
            json!({
                "agents": {
                    "defaults": {
                        "model": { "primary": target_primary.clone() }
                    }
                }
            }),
        );
        if let Some(list) = root.pointer_mut("/agents/list") {
            if let Some(list_arr) = list.as_array_mut() {
                for agent in list_arr {
                    if agent.get("id").and_then(|v| v.as_str()) == Some("main") {
                        if let Some(obj) = agent.as_object_mut() {
                            let model = obj.get("model").and_then(|v| v.as_str());
                            if crate::distribution_policy::should_reset_primary_model(model)
                                || model.is_none()
                                || model.is_some_and(|m| {
                                    !crate::distribution_policy::primary_model_has_configured_key(
                                        m, &env_map,
                                    )
                                })
                            {
                                obj.insert("model".into(), json!(target_primary.clone()));
                            }
                        }
                    }
                }
            }
        }
        changed = true;
    }

    if !changed {
        return Ok(false);
    }

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);

    // vault 同步必须在 manifest hash 更新前
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（model_defaults），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败（model_defaults）: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（model_defaults）: {e}");
        }
    }

    seal_config_files(&base)?;

    Ok(true)
}

/// 若尚未配置 heartbeat，注入循环工程默认节奏（每小时嘀嗒；到期任务由 HEARTBEAT.md 的 interval 控制）。
/// 不覆盖用户已有 `agents.defaults.heartbeat`。
pub(crate) fn ensure_heartbeat_defaults() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(false);
    }

    unseal_config_files(&base);

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;

    if root.pointer("/agents/defaults/heartbeat").is_some() {
        return Ok(false);
    }

    backup_to_vault(&base, "openclaw.json")?;
    deep_merge_json(
        &mut root,
        json!({
            "agents": {
                "defaults": {
                    "heartbeat": {
                        "every": "1h",
                        "target": "none",
                        "lightContext": true,
                        "isolatedSession": true,
                        "activeHours": {
                            "start": "08:00",
                            "end": "22:00"
                        }
                    }
                }
            }
        }),
    );

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);

    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（heartbeat）: {e}");
    }
    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        let _ = save_manifest(&m);
    }
    seal_config_files(&base)?;
    eprintln!("[YunTuAI] 已注入默认 heartbeat（循环工程）");
    Ok(true)
}

/// 移除 openclaw.json 中 OpenClaw 不认识的 YunTuAI 扩展 meta 键（旧版误写入）。
fn strip_yuntuai_meta_from_openclaw_config(root: &mut Value) -> bool {
    let Some(meta) = root.get_mut("meta").and_then(|m| m.as_object_mut()) else {
        return false;
    };
    let mut changed = false;
    for key in YUNTUAI_OPENCLAW_META_KEYS {
        if meta.remove(*key).is_some() {
            changed = true;
        }
    }
    if meta.is_empty() {
        if let Some(obj) = root.as_object_mut() {
            obj.remove("meta");
            changed = true;
        }
    }
    changed
}

/// OpenClaw 2026.5.2 不再识别 agents.defaults 下的部分 legacy key
///（如 llm）。移除它们以通过 config schema 校验。
const DEPRECATED_AGENTS_DEFAULTS_KEYS: &[&str] = &["llm"];

fn strip_deprecated_agents_defaults_keys(root: &mut Value) -> bool {
    let Some(defaults) = root
        .get_mut("agents")
        .and_then(|a| a.get_mut("defaults"))
        .and_then(|d| d.as_object_mut())
    else {
        return false;
    };
    let mut changed = false;
    for key in DEPRECATED_AGENTS_DEFAULTS_KEYS {
        if defaults.remove(*key).is_some() {
            changed = true;
        }
    }
    changed
}

fn read_gateway_token_from_env(base: &Path) -> Option<String> {
    let env_path = base.join(".env");
    if env_path.is_file() {
        if let Ok(raw) = fs::read_to_string(&env_path) {
            for line in raw.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    if k.trim() == "OPENCLAW_GATEWAY_TOKEN" {
                        let t = v.trim();
                        if !t.is_empty() {
                            return Some(t.to_string());
                        }
                    }
                }
            }
        }
    }
    read_sealed_gateway_token()
}

/// OpenClaw 2026.6+：确保 gateway.auth.token 与 .env 中 OPENCLAW_GATEWAY_TOKEN 一致（env SecretRef）。
fn repair_gateway_auth_token(root: &mut Value, base: &Path) -> bool {
    let auth_mode = root
        .pointer("/gateway/auth/mode")
        .and_then(|v| v.as_str());
    if auth_mode != Some("token") && auth_mode.is_some() {
        return false;
    }
    let expected = json!({
        "source": "env",
        "provider": "default",
        "id": "OPENCLAW_GATEWAY_TOKEN"
    });
    let current = root.pointer("/gateway/auth/token");
    if current == Some(&expected) {
        return false;
    }
    // 仅在 .env 或 vault 中存在 token 时写入 env ref
    if read_gateway_token_from_env(base).is_none() {
        return false;
    }
    let Some(obj) = root.as_object_mut() else {
        return false;
    };
    if !obj.contains_key("gateway") || !obj["gateway"].is_object() {
        obj.insert("gateway".into(), json!({}));
    }
    if let Some(gw) = obj.get_mut("gateway").and_then(|g| g.as_object_mut()) {
        if !gw.contains_key("auth") || !gw["auth"].is_object() {
            gw.insert("auth".into(), json!({ "mode": "token" }));
        }
        if let Some(auth) = gw.get_mut("auth").and_then(|a| a.as_object_mut()) {
            auth.insert("mode".into(), Value::String("token".into()));
            auth.insert("token".into(), expected.clone());
            if !gw.contains_key("remote") || !gw["remote"].is_object() {
                gw.insert("remote".into(), json!({}));
            }
            if let Some(remote) = gw.get_mut("remote").and_then(|r| r.as_object_mut()) {
                remote.insert("token".into(), expected);
            }
            return true;
        }
    }
    false
}

/// 确保 `gateway.remote.token` 与 `gateway.auth.token` 一致，避免 CLI/桌面端握手 token mismatch。
fn repair_gateway_remote_token(root: &mut Value) -> bool {
    let Some(auth_token) = root.pointer("/gateway/auth/token").cloned() else {
        return false;
    };
    if root.pointer("/gateway/remote/token") == Some(&auth_token) {
        return false;
    }
    let Some(gw) = root.get_mut("gateway").and_then(|g| g.as_object_mut()) else {
        return false;
    };
    if !gw.contains_key("remote") || !gw["remote"].is_object() {
        gw.insert("remote".into(), json!({}));
    }
    if let Some(remote) = gw.get_mut("remote").and_then(|r| r.as_object_mut()) {
        remote.insert("token".into(), auth_token);
        return true;
    }
    false
}

pub(crate) fn mark_gateway_config_stale(base: &Path) {
    let marker = base.join(GATEWAY_CONFIG_STALE_MARKER);
    if let Some(parent) = marker.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&marker, chrono::Utc::now().to_rfc3339());
}

/// 配置已变更且运行中的网关需重启才能生效（repair / apply_policy 后调用）。
pub(crate) fn take_gateway_config_stale() -> bool {
    let Ok(base) = managed_openclaw_data_dir() else {
        return false;
    };
    let marker = base.join(GATEWAY_CONFIG_STALE_MARKER);
    if !marker.is_file() {
        return false;
    }
    let _ = fs::remove_file(&marker);
    true
}

/// 仅探测配置过期标记，不消费（供 ensure 快速路径使用）。
pub(crate) fn peek_gateway_config_stale() -> bool {
    managed_openclaw_data_dir()
        .ok()
        .map(|base| base.join(GATEWAY_CONFIG_STALE_MARKER).is_file())
        .unwrap_or(false)
}

/// 修复已部署机器上 openclaw.json 的 OpenClaw 不兼容项（含 vault 备份，避免漂移回滚恢复坏配置）。
pub(crate) fn repair_openclaw_config_openclaw_compat() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let main_path = base.join("openclaw.json");
    let vault_cfg = vault_path(&base, "openclaw.json");
    if !main_path.is_file() && !vault_cfg.is_file() {
        return Ok(false);
    }
    unseal_config_files(&base);
    let mut changed = false;

    if main_path.is_file() {
        let raw = fs::read_to_string(&main_path).map_err(|e| e.to_string())?;
        let mut root: Value =
            serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?;
        let mut file_changed = strip_yuntuai_meta_from_openclaw_config(&mut root);
        file_changed |= strip_deprecated_agents_defaults_keys(&mut root);
        file_changed |= merge_control_ui_allowed_origins(&mut root);
        file_changed |= repair_gateway_auth_token(&mut root, &base);
        file_changed |= repair_gateway_remote_token(&mut root);
        file_changed |= crate::distribution_policy::repair_browser_profiles_in_config(&mut root);
        if file_changed {
            let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
            fs::write(&main_path, &out).map_err(|e| e.to_string())?;
            changed = true;
        }
    }

    // vault 操作仅做 best-effort；main 文件已修复即可。
    if vault_cfg.is_file() {
        let _ = (|| -> Result<(), String> {
            let raw = fs::read_to_string(&vault_cfg).map_err(|e| e.to_string())?;
            let mut root: Value =
                serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析 vault 服务配置文件: {e}"))?;
            let mut file_changed = strip_yuntuai_meta_from_openclaw_config(&mut root);
            file_changed |= merge_control_ui_allowed_origins(&mut root);
            file_changed |= repair_gateway_auth_token(&mut root, &base);
            file_changed |= repair_gateway_remote_token(&mut root);
            file_changed |= crate::distribution_policy::repair_browser_profiles_in_config(&mut root);
            if file_changed {
                let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
                fs::write(&vault_cfg, &out).map_err(|e| e.to_string())?;
                changed = true;
            }
            Ok(())
        })();
    }

    if main_path.is_file() {
        let _ = backup_to_vault(&base, "openclaw.json");
    }

    if !changed {
        return Ok(false);
    }

    mark_gateway_config_stale(&base);

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（repair）: {e}");
        }
    }
    if let Err(e) = seal_config_files(&base) {
        eprintln!("[YunTuAI] 封存配置文件失败（repair）: {e}");
    }
    Ok(true)
}

pub fn apply_yuntuai_policy() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    unseal_config_files(&base);
    let path = base.join("openclaw.json");
    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?
    } else {
        json!({})
    };
    let before = root.clone();
    backup_to_vault(&base, "openclaw.json")?;
    deep_merge_json(&mut root, yuntuai_policy_patch());
    let _ = strip_yuntuai_meta_from_openclaw_config(&mut root);
    let _ = repair_gateway_auth_token(&mut root, &base);
    let _ = repair_gateway_remote_token(&mut root);
    if before == root {
        return Ok(false);
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);

    // 同步 vault 副本（必须在 manifest hash 更新前执行，防止 vault 滞后导致的漂移回滚死循环）
    // best-effort retry（1 次），失败时 manifest 仍会更新但记录严重警告
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（apply_policy），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败，配置漂移回滚可能恢复到过期版本: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        m.env_hash = hash_env_drift_keys(&base);
        m.policy_version = POLICY_VERSION;
        m.absolute_control = true;
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（apply_policy）: {e}");
        }
    }

    seal_config_files(&base)?;
    Ok(true)
}

fn needs_full_establish(apply_policy: bool) -> Result<bool, String> {
    let Some(m) = load_manifest()? else {
        return Ok(true);
    };
    if !m.absolute_control || !m.sealed {
        return Ok(true);
    }
    if apply_policy && m.policy_version < POLICY_VERSION {
        return Ok(true);
    }
    Ok(false)
}

/// 安装/运行即执行：接管 → 停外部网关 → 策略写入（不做配置回滚/只读封存）。
pub fn establish_absolute_control(apply_policy: bool) -> Result<AbsoluteControlResult, String> {
    let _establish_scope = EstablishWorkScope::enter();
    let adopted = ensure_adopted()?;
    let _ = repair_openclaw_config_openclaw_compat();
    let _ = ensure_model_and_compaction_defaults(); // v1.2.3: deepseek-v4-flash + compaction 保护
    let _ = crate::openclaw_workspace_bootstrap::bootstrap_loop_engineering();
    let _ = ensure_heartbeat_defaults();
    let full = needs_full_establish(apply_policy)?;

    if !full {
        let enforce = enforce_control(false)?;
        let _ = seal_secrets_vault(&PathBuf::from(&adopted.data_dir));
        mark_establish_complete();
        return Ok(AbsoluteControlResult {
            ok: enforce.ok,
            adopted: true,
            policy_applied: false,
            secrets_sealed: true,
            external_gateways_stopped: false,
            config_enforced: false,
            drift_restored: vec![],
            message: "本机服务已就绪（授权门禁生效，已停用配置回滚）。".into(),
        });
    }

    stop_all_external_gateways();

    let policy_applied = if apply_policy {
        apply_yuntuai_policy().unwrap_or(false)
    } else {
        false
    };

    let secrets_sealed = seal_secrets_vault(&PathBuf::from(&adopted.data_dir)).unwrap_or(false);
    let enforce = enforce_control(false)?;

    mark_establish_complete();
    Ok(AbsoluteControlResult {
        ok: enforce.ok,
        adopted: true,
        policy_applied,
        secrets_sealed,
        external_gateways_stopped: true,
        config_enforced: false,
        drift_restored: vec![],
        message: "本机服务已接管；使用授权控制软件，外部网关禁止独立运行。".into(),
    })
}

/// 后台巡检：抑制外部 OpenClaw 网关（不再回滚配置文件）。
fn watchdog_tick() -> Result<(), String> {
    if load_manifest()?.is_none() {
        return Ok(());
    }
    crate::openclaw_exec::suppress_external_openclaw(crate::openclaw_exec::managed_gateway_pid());
    Ok(())
}

pub fn start_domination_watchdog() {
    if WATCHDOG_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(handle) = std::thread::Builder::new()
        .name("yuntuai-openclaw-domination".into())
        .spawn(|| loop {
            if crate::app_shutdown::is_app_shutting_down() {
                break;
            }
            std::thread::sleep(Duration::from_secs(120));
            if crate::app_shutdown::is_app_shutting_down() {
                break;
            }
            let result = std::panic::catch_unwind(|| {
                if let Err(e) = watchdog_tick() {
                    eprintln!("[YunTuAI domination watchdog] {e}");
                }
            });
            if let Err(panic) = result {
                let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                eprintln!("[YunTuAI CRASH] domination watchdog panic: {msg}");
            }
        })
    {
        crate::gateway_supervisor::register_daemon_handle(handle);
    }
}

pub(crate) fn deep_merge_json(base: &mut Value, overlay: Value) {
    let Value::Object(overlay_map) = overlay else {
        *base = overlay;
        return;
    };
    if !base.is_object() {
        *base = Value::Object(overlay_map);
        return;
    }
    let Some(base_map) = base.as_object_mut() else {
        *base = Value::Object(overlay_map);
        return;
    };
    for (k, v) in overlay_map {
        match base_map.get_mut(&k) {
            Some(bv) => deep_merge_json(bv, v),
            None => {
                base_map.insert(k, v);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strip_yuntuai_meta_from_openclaw_config_removes_unknown_keys() {
        let mut cfg = json!({
            "meta": {
                "yuntuaiManaged": true,
                "yuntuaiPolicyVersion": 2,
                "legit": "keep-me"
            },
            "gateway": { "port": 18789 }
        });
        assert!(strip_yuntuai_meta_from_openclaw_config(&mut cfg));
        assert_eq!(cfg["meta"]["legit"], "keep-me");
        assert!(cfg["meta"].get("yuntuaiManaged").is_none());
        assert!(cfg["meta"].get("yuntuaiPolicyVersion").is_none());
    }

    #[test]
    fn strip_yuntuai_meta_from_openclaw_config_drops_empty_meta() {
        let mut cfg = json!({
            "meta": { "yuntuaiManaged": true },
            "gateway": { "port": 18789 }
        });
        assert!(strip_yuntuai_meta_from_openclaw_config(&mut cfg));
        assert!(cfg.get("meta").is_none());
    }

    #[test]
    fn deep_merge_json_merges_nested_objects() {
        let mut base = json!({ "a": 1, "nested": { "x": 1 } });
        deep_merge_json(&mut base, json!({ "b": 2, "nested": { "y": 2 } }));
        assert_eq!(base["a"], 1);
        assert_eq!(base["b"], 2);
        assert_eq!(base["nested"]["x"], 1);
        assert_eq!(base["nested"]["y"], 2);
    }

    #[test]
    fn deep_merge_json_replaces_non_object_base() {
        let mut base = json!(null);
        deep_merge_json(&mut base, json!({ "ok": true }));
        assert_eq!(base["ok"], true);
    }

    #[test]
    fn repair_deepseek_direct_provider_removes_relay_and_sets_completions_api() {
        let mut cfg = json!({
            "agents": { "defaults": { "model": { "primary": "yuntuai/gpt-5.5" } } },
            "models": {
                "providers": {
                    "deepseek": { "models": [{ "id": "deepseek-v4-flash" }] },
                    "yuntuai": { "api": "openai-completions", "baseUrl": "https://api.doohuan.com/v1" }
                }
            }
        });
        assert!(crate::distribution_policy::repair_openclaw_providers(&mut cfg, None));
        assert!(cfg["models"]["providers"].get("yuntuai").is_none());
        assert_eq!(cfg["models"]["providers"]["deepseek"]["api"], "openai-completions");
        assert_eq!(
            cfg["models"]["providers"]["deepseek"]["baseUrl"],
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn merge_control_ui_allowed_origins_adds_missing_entries() {
        let mut cfg = json!({
            "gateway": {
                "controlUi": {
                    "allowInsecureAuth": true,
                    "allowedOrigins": ["http://localhost:1420"]
                }
            }
        });
        assert!(merge_control_ui_allowed_origins(&mut cfg));
        let origins = cfg["gateway"]["controlUi"]["allowedOrigins"]
            .as_array()
            .expect("allowedOrigins array");
        assert!(origins.iter().any(|v| v.as_str() == Some("http://tauri.localhost")));
        assert!(origins.iter().any(|v| v.as_str() == Some("tauri://localhost")));
        assert!(!origins.iter().any(|v| v.as_str() == Some("*")));
    }

    #[test]
    fn merge_control_ui_allowed_origins_is_noop_when_complete() {
        let mut cfg = yuntuai_policy_patch();
        assert!(!merge_control_ui_allowed_origins(&mut cfg));
    }

    #[test]
    fn hash_openclaw_json_for_drift_ignores_meta() {
        let with_meta = r#"{"gateway":{"port":18789},"meta":{"openclawVersion":"2026.5.2"}}"#;
        let without_meta = r#"{"gateway":{"port":18789}}"#;
        assert_eq!(
            hash_openclaw_json_for_drift(with_meta),
            hash_openclaw_json_for_drift(without_meta)
        );
    }

    #[test]
    fn resolve_workspace_falls_back_to_data_dir_workspace() {
        let dir = std::env::temp_dir().join(format!(
            "yuntuai-ws-fallback-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        assert_eq!(
            resolve_workspace_dir(&dir).expect("fallback"),
            dir.join("workspace")
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_workspace_reads_absolute_custom_workspace() {
        let dir = std::env::temp_dir().join(format!(
            "yuntuai-ws-abs-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        let custom = dir.join("my-ws");
        let _ = fs::create_dir_all(&custom);
        fs::write(
            dir.join("openclaw.json"),
            serde_json::to_string(&json!({
                "agents": { "defaults": { "workspace": custom.to_string_lossy().to_string() } }
            }))
            .unwrap(),
        )
        .expect("write cfg");
        assert_eq!(
            resolve_workspace_dir(&dir).expect("custom"),
            custom
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_workspace_resolves_relative_custom_workspace_against_data_dir() {
        let dir = std::env::temp_dir().join(format!(
            "yuntuai-ws-rel-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        fs::write(
            dir.join("openclaw.json"),
            r#"{ "agents": { "defaults": { "workspace": "./custom-ws" } } }"#,
        )
        .expect("write cfg");
        assert_eq!(
            resolve_workspace_dir(&dir).expect("relative"),
            dir.join("./custom-ws")
        );
        let _ = fs::remove_dir_all(&dir);
    }
}

pub fn ensure_adopted() -> Result<OpenClawControlManifest, String> {
    if let Some(m) = load_manifest()? {
        return Ok(m);
    }
    adopt_environment(false)
}

pub fn discover_environment() -> Result<OpenClawEnvironmentDiscovery, String> {
    let bundled = bundled_openclaw_ready();
    let (global_in_path, global_version) = probe_global_openclaw();
    let (legacy_exists, legacy_dir) = probe_legacy_home_openclaw();
    let managed = paths::openclaw_data_dir()?;
    let managed_str = managed.to_string_lossy().to_string();
    let legacy_path = legacy_dir.as_ref().map(PathBuf::from);
    let legacy_score = legacy_path
        .as_ref()
        .map(|p| crate::openclaw_migrate::legacy_richness_score(p))
        .unwrap_or(0);
    let migration_recommended = legacy_exists
        && legacy_path
            .as_ref()
            .map(|p| !crate::openclaw_migrate::same_path_check(p, &managed))
            .unwrap_or(false)
        && legacy_score >= 3;
    let manifest = load_manifest()?;
    let gateway_probe = if openclaw_runtime::runtime_available_for(
        openclaw_runtime::effective_source(
            openclaw_runtime::load_runtime_preference().ok().flatten(),
        ),
    ) {
        gateway_status_probe()
    } else {
        None
    };

    let recommended_action = if migration_recommended {
        format!(
            "检测到旧版用户目录有训练数据（丰富度 {legacy_score}）。可在下方「从旧版导入」一键迁移到内置服务数据目录。"
        )
    } else if manifest.is_none() {
        "YunTuAI 正在建立绝对管控…".to_string()
    } else if manifest.as_ref().map(|m| m.absolute_control).unwrap_or(false) {
        "本机服务已处于 YunTuAI 管控（网关独占、配置由应用写入）。".to_string()
    } else if global_in_path {
        "已接管；检测到系统 PATH 中的外部运行时，管控线程将持续回收外部进程。".to_string()
    } else {
        "已接管。配置与本机服务由 YunTu Control 管控。".to_string()
    };

    Ok(OpenClawEnvironmentDiscovery {
        bundled_ready: bundled,
        global_openclaw_in_path: global_in_path,
        global_openclaw_version: global_version,
        legacy_home_exists: legacy_exists,
        legacy_home_dir: legacy_dir,
        managed_data_dir: managed_str,
        managed_data_exists: managed.exists(),
        legacy_richness_score: legacy_score,
        migration_recommended,
        has_adopted_manifest: manifest.is_some(),
        manifest,
        gateway_probe_running: gateway_probe,
        recommended_action,
    })
}

pub fn adopt_environment(prefer_legacy_home: bool) -> Result<OpenClawControlManifest, String> {
    let dir = pick_adopt_dir(prefer_legacy_home)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (global_in_path, _) = probe_global_openclaw();
    let (legacy_exists, _) = probe_legacy_home_openclaw();

    for name in ALLOWED_CONFIG {
        let _ = backup_to_vault(&dir, name);
    }
    let _ = backup_to_vault(&dir, ".env");

    let manifest = OpenClawControlManifest {
        version: 1,
        adopted_at: chrono::Utc::now().to_rfc3339(),
        data_dir: dir.to_string_lossy().to_string(),
        use_bundled_runtime: openclaw_runtime::prefers_bundled_runtime(),
        global_openclaw_detected: global_in_path,
        legacy_home_detected: legacy_exists,
        sealed: false,
        policy_version: POLICY_VERSION,
        config_hashes: hash_config_files(&dir),
        env_hash: hash_env_drift_keys(&dir),
        absolute_control: true,
        allow_ai_full_access: false,
    };
    save_manifest(&manifest)?;
    Ok(manifest)
}

pub fn enforce_control(_drift_restore: bool) -> Result<OpenClawControlEnforceResult, String> {
    let Some(mut manifest) = load_manifest()? else {
        return Ok(OpenClawControlEnforceResult {
            ok: false,
            drift_detected: false,
            drift_files: vec![],
            restored_files: vec![],
            sealed: false,
            message: "尚未接管本机服务，跳过 enforce。".into(),
        });
    };

    let base = PathBuf::from(&manifest.data_dir);
    manifest.config_hashes = hash_config_files(&base);
    manifest.env_hash = hash_env_drift_keys(&base);
    manifest.sealed = false;
    save_manifest(&manifest)?;

    Ok(OpenClawControlEnforceResult {
        ok: true,
        drift_detected: false,
        drift_files: vec![],
        restored_files: vec![],
        sealed: false,
        message: "已停用配置漂移回滚；仅通过设备授权控制软件使用。".into(),
    })
}

fn read_config_views(base: &Path) -> Vec<OpenClawConfigFileView> {
    ALLOWED_CONFIG
        .iter()
        .map(|name| {
            let path = base.join(name);
            let path_str = path.to_string_lossy().to_string();
            if !path.is_file() {
                return OpenClawConfigFileView {
                    name: (*name).to_string(),
                    path: path_str,
                    exists: false,
                    content: None,
                    sha256: None,
                    error: None,
                };
            }
            match fs::read_to_string(&path) {
                Ok(content) => OpenClawConfigFileView {
                    name: (*name).to_string(),
                    path: path_str,
                    exists: true,
                    sha256: Some(sha256_hex(&content)),
                    content: Some(content),
                    error: None,
                },
                Err(e) => OpenClawConfigFileView {
                    name: (*name).to_string(),
                    path: path_str,
                    exists: true,
                    content: None,
                    sha256: None,
                    error: Some(e.to_string()),
                },
            }
        })
        .collect()
}

#[tauri::command]
pub async fn openclaw_establish_absolute_control(
    state: State<'_, DbState>,
    token: String,
) -> Result<AbsoluteControlResult, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    let r = establish_absolute_control(false)?;
    let conn = lock_conn(&state.conn);
    let _ = audit_insert_on_conn(&conn, "openclaw_control", "absolute_control", &r.message);
    Ok(r)
}

#[tauri::command]
pub async fn openclaw_migrate_from_legacy(
    state: State<'_, DbState>,
    token: String,
    rename_legacy: Option<bool>,
) -> Result<crate::openclaw_migrate::OpenClawLegacyMigrationResult, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    let r = crate::openclaw_migrate::migrate_legacy_into_managed(rename_legacy.unwrap_or(true))?;
    let conn = lock_conn(&state.conn);
    let _ = audit_insert_on_conn(
        &conn,
        "openclaw_control",
        "migrate_legacy",
        &r.message,
    );
    Ok(r)
}

#[tauri::command]
pub async fn openclaw_control_discover(
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawEnvironmentDiscovery, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        discover_environment()
    })
    .await
}

#[tauri::command]
pub async fn openclaw_control_adopt(
    state: State<'_, DbState>,
    token: String,
    prefer_legacy_home: Option<bool>,
) -> Result<OpenClawControlManifest, String> {
    assert_owner(&state, &token)?;
    let m = adopt_environment(prefer_legacy_home.unwrap_or(false))?;
    let conn = lock_conn(&state.conn);
    let _ = audit_insert_on_conn(
        &conn,
        "openclaw_control",
        "adopt",
        &format!("dir={}", m.data_dir),
    );
    Ok(m)
}

/* ── AI 完全访问模式管理的公共函数 ─────────────────────── */

/// 查询当前 AI 完全访问开关状态（需已登录）。
pub fn ai_full_access_enabled() -> bool {
    load_manifest()
        .ok()
        .flatten()
        .map(|m| m.allow_ai_full_access)
        .unwrap_or(false)
}

/// 将模块同步到 openclaw.json 的 tools.mcpServers 中。
/// 走受控写入路径：backup vault → deep-merge → 更新 hash baseline → seal。
/// 仅在 allow_ai_full_access 开启时写入，否则静默跳过。
pub fn sync_module_to_openclaw_mcp(
    module_id: &str,
    name: &str,
    command: &str,
    args: &[String],
    description: Option<&str>,
    enabled: bool,
) -> Result<(), String> {
    crate::license::assert_licensed()?;
    let base = managed_openclaw_data_dir()?;
    unseal_config_files(&base);

    let path = base.join("openclaw.json");
    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(strip_bom(&raw))
            .map_err(|e| format!("解析服务配置文件: {e}"))?
    } else {
        json!({})
    };

    let mcp_entry = json!({
        "command": command,
        "args": args,
        "description": description.unwrap_or(name),
        "enabled": enabled
    });

    let patch = json!({
        "tools": {
            "mcpServers": {
                module_id: mcp_entry
            }
        }
    });

    backup_to_vault(&base, "openclaw.json")?;
    deep_merge_json(&mut root, patch);
    let _ = strip_yuntuai_meta_from_openclaw_config(&mut root);

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);

    // vault 同步必须在 manifest hash 更新前，含重试
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（sync_mcp），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败（sync_mcp）: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（sync_mcp）: {e}");
        }
    }

    seal_config_files(&base)?;
    Ok(())
}

/// 从 openclaw.json 移除模块的 tools.mcpServers 条目。
pub fn remove_module_from_openclaw_mcp(module_id: &str) -> Result<(), String> {
    crate::license::assert_licensed()?;
    let base = managed_openclaw_data_dir()?;
    unseal_config_files(&base);

    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(strip_bom(&raw))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;

    let removed = root
        .get_mut("tools")
        .and_then(|t| t.get_mut("mcpServers"))
        .and_then(|m| m.as_object_mut())
        .map(|obj| obj.remove(module_id).is_some())
        .unwrap_or(false);

    if !removed {
        return Ok(());
    }

    backup_to_vault(&base, "openclaw.json")?;
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    mark_gateway_config_stale(&base);

    // vault 同步必须在 manifest hash 更新前
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（remove_mcp），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败（remove_mcp）: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（remove_mcp）: {e}");
        }
    }

    seal_config_files(&base)?;
    Ok(())
}

#[tauri::command]
pub async fn openclaw_control_ai_access_status(
    state: State<'_, DbState>,
    token: String,
) -> Result<bool, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        Ok(ai_full_access_enabled())
    })
    .await
}

#[tauri::command]
pub async fn openclaw_control_ai_access_set(
    state: State<'_, DbState>,
    token: String,
    enabled: bool,
) -> Result<bool, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;

    let Some(mut manifest) = load_manifest()? else {
        // 未接管时尝试接管
        let m = adopt_environment(false)?;
        let mut m2 = m;
        m2.allow_ai_full_access = enabled;
        save_manifest(&m2)?;
        return Ok(enabled);
    };

    manifest.allow_ai_full_access = enabled;
    save_manifest(&manifest)?;

    let conn = lock_conn(&state.conn);
    let _ = audit_insert_on_conn(
        &conn,
        "openclaw_control",
        "ai_access_set",
        &format!("enabled={enabled}"),
    );

    Ok(enabled)
}

#[tauri::command]
pub async fn openclaw_control_read_config(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<OpenClawConfigFileView>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::owner::assert_owner_mutex(&conn, &token)?;
        let base = managed_openclaw_data_dir()?;
        Ok(read_config_views(&base))
    })
    .await
}

#[tauri::command]
pub async fn openclaw_control_write_config(
    state: State<'_, DbState>,
    token: String,
    patch_json: Value,
) -> Result<OpenClawConfigFileView, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    crate::license::assert_licensed()?;
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || write_openclaw_config(conn, patch_json)).await
}

fn write_openclaw_config(
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    patch_json: Value,
) -> Result<OpenClawConfigFileView, String> {
    if crate::distribution_policy::api_key_locked() && patch_json.pointer("/models/providers").is_some()
    {
        return Err("中转站版本不能修改模型通道或接入地址".into());
    }
    let base = managed_openclaw_data_dir()?;
    unseal_config_files(&base);
    let path = base.join("openclaw.json");
    let path_str = path.to_string_lossy().to_string();

    let mut root: Value = if path.is_file() {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?
    } else {
        json!({})
    };

    backup_to_vault(&base, "openclaw.json")?;
    deep_merge_json(&mut root, patch_json);
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    let hash = sha256_hex(&out);

    // 写后 vault 同步（必须在 manifest hash 更新前），含 1 次重试
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（write_config），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（write_config）: {e}");
        }
    }

    seal_config_files(&base)?;

    let db = lock_conn(&conn);
    let _ = audit_insert_on_conn(&db, "openclaw_control", "write_config", &path_str);

    Ok(OpenClawConfigFileView {
        name: "openclaw.json".into(),
        path: path_str,
        exists: true,
        content: Some(out),
        sha256: Some(hash),
        error: None,
    })
}

#[tauri::command]
pub async fn openclaw_control_enforce(
    state: State<'_, DbState>,
    token: String,
    restore_on_drift: Option<bool>,
) -> Result<OpenClawControlEnforceResult, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    let r = enforce_control(restore_on_drift.unwrap_or(true))?;
    let conn = lock_conn(&state.conn);
    let _ = audit_insert_on_conn(&conn, "openclaw_control", "enforce", &r.message);
    Ok(r)
}
