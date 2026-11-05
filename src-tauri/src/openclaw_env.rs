//! 内置 OpenClaw 运行时的 `.env` API Key 检测与写入（用户可编辑项，不参与网关漂移回滚）。

use crate::db::DbState;
use crate::openclaw::bundled_openclaw_ready;
use crate::openclaw_control::{
    backup_to_vault, hash_env_drift_keys, load_manifest, managed_openclaw_data_dir, save_manifest,
    seal_config_files, unseal_for_write,
};
use crate::openclaw_runtime::{strip_bom, RuntimeSource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvKeyRequirement {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub configured: bool,
    pub required: bool,
    #[serde(default = "default_true")]
    pub editable: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawEnvStatus {
    /// 当前由 YunTuAI 内置便携 OpenClaw 提供服务（需引导用户填写模型 Key）。
    pub bundled_managed: bool,
    /// 至少一项必填 Key 仍为空。
    pub setup_required: bool,
    /// 发行包已锁定 API Key，用户不可修改。
    pub api_key_locked: bool,
    pub keys: Vec<EnvKeyRequirement>,
    pub env_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionProfileInfo {
    pub profile: String,
    /// 用户可见发行档名称（如「内部版」）
    pub profile_label: String,
    pub api_key_locked: bool,
    pub open_registration: bool,
    pub default_model_id: String,
    pub dev_agnes_enabled: bool,
}

fn env_label(id: &str) -> (String, String) {
    match id {
        "DEEPSEEK_API_KEY" => (
            "DeepSeek API Key".into(),
            "在 platform.deepseek.com 创建，用于 DeepSeek V4.1 Flash 等多模态模型。".into(),
        ),
        "DASHSCOPE_API_KEY" => (
            "千问 API Key（DashScope）".into(),
            "在阿里云百炼控制台（bailian.console.aliyun.com）创建 API Key，用于 Qwen3.6 / Qwen3.7 多模态模型。".into(),
        ),
        "MIMO_API_KEY" => (
            "小米 MiMo API Key".into(),
            "在小米 MiMo 开放平台（mimo.mi.com）创建。与 DeepSeek / 千问任选一家即可开始使用；支持 V2.5 / V2.5 Pro 与多模态识图。".into(),
        ),
        "YUNTUAI_API_KEY" => (
            "云图中转站 API Key".into(),
            "在云图中转站控制台获取 API Key。".into(),
        ),
        "AGNES_API_KEY" => (
            "Agnes API Key".into(),
            "开发版专用。在 agnes-ai.com 申请，写入 scripts/agens-api-key.secret 或环境变量 AGNES_API_KEY。".into(),
        ),
        other => (other.replace('_', " "), format!("环境变量 {other}")),
    }
}

fn env_key_display_rank(id: &str) -> usize {
    match id {
        "DEEPSEEK_API_KEY" => 0,
        "MIMO_API_KEY" => 1,
        "DASHSCOPE_API_KEY" => 2,
        "YUNTUAI_API_KEY" => 3,
        "AGNES_API_KEY" => 4,
        _ => 99,
    }
}

fn parse_env_map(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.starts_with('#') {
            if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                if !key.is_empty() {
                    out.insert(key.to_string(), v.trim().to_string());
                }
            }
            continue;
        }
        // 修复注释行末尾误拼接 KEY=value（回退/合并配置时偶发）
        for token in line.split_whitespace() {
            let token = token.trim_start_matches('#');
            if let Some((k, v)) = token.split_once('=') {
                let key = k.trim();
                if key.is_empty() {
                    continue;
                }
                if key
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                {
                    out.insert(key.to_string(), v.trim().to_string());
                }
            }
        }
    }
    out
}

fn collect_env_key_ids(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            if let (Some(Value::String(source)), Some(Value::String(id))) =
                (map.get("source"), map.get("id"))
            {
                if source == "env" && !id.trim().is_empty() {
                    out.insert(id.trim().to_string());
                }
            }
            for v in map.values() {
                collect_env_key_ids(v, out);
            }
        }
        Value::Array(items) => {
            for v in items {
                collect_env_key_ids(v, out);
            }
        }
        _ => {}
    }
}

fn required_model_env_keys(cfg: &Value) -> Vec<String> {
    let mut ids = HashSet::new();
    if let Some(models) = cfg.get("models") {
        collect_env_key_ids(models, &mut ids);
    }
    for (id, _) in crate::distribution_policy::profile_api_env_keys() {
        ids.insert(id.to_string());
    }
    ids.retain(|k| k != "OPENCLAW_GATEWAY_TOKEN");
    let mut list: Vec<_> = ids.into_iter().collect();
    list.sort();
    list
}

fn api_env_key_required(id: &str) -> bool {
    if crate::distribution_policy::api_key_locked() {
        return false;
    }
    crate::distribution_policy::profile_api_env_keys()
        .iter()
        .find(|(key, _)| *key == id)
        .map(|(_, required)| *required)
        .unwrap_or(false)
}

/// 直连档：MiMo / DeepSeek / 千问至少配置一家；中转站：主 Key 或内嵌 Key。
fn env_has_api_key(env_map: &HashMap<String, String>, key: &str) -> bool {
    env_map
        .get(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn model_provider_setup_satisfied(env_map: &HashMap<String, String>) -> bool {
    if crate::distribution_policy::api_key_locked() {
        return crate::distribution_policy::embedded_relay_api_key().is_some()
            || env_map
                .get(crate::distribution_policy::active_distribution_profile().primary_api_env_key())
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
    }
    match crate::distribution_policy::active_distribution_profile() {
        crate::distribution_policy::DistributionProfile::Internal => {
            env_has_api_key(env_map, "MIMO_API_KEY")
                || env_has_api_key(env_map, "DEEPSEEK_API_KEY")
                || env_has_api_key(env_map, "DASHSCOPE_API_KEY")
                || crate::llm_user_providers::any_extra_key_configured(env_map)
        }
        crate::distribution_policy::DistributionProfile::RelayStation => {
            env_has_api_key(env_map, "YUNTUAI_API_KEY")
        }
    }
}

/// 按已配置的厂商 Key 选择默认主模型（无 MiMo 时避免仍指向 mimo 导致无法对话）。
pub(crate) fn preferred_primary_model_for_env_keys(
    env_map: &HashMap<String, String>,
) -> Option<String> {
    crate::distribution_policy::preferred_primary_model_for_env_keys(env_map)
}

fn sync_primary_model_from_env_keys(env_map: &HashMap<String, String>) -> Result<(), String> {
    let Some(primary_model) = preferred_primary_model_for_env_keys(env_map) else {
        return Ok(());
    };
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(());
    }
    crate::openclaw_control::unseal_for_write(&base);
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value =
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?;
    let current = root
        .pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if current == primary_model {
        return Ok(());
    }
    // 用户已选的主模型对应 Key 仍在，不要在保存 Key 时强行改回 MiMo。
    if !current.is_empty()
        && crate::distribution_policy::primary_model_has_configured_key(current, env_map)
    {
        return Ok(());
    }
    if let Some(agents) = root.get_mut("agents") {
        if let Some(defaults) = agents.get_mut("defaults") {
            if let Some(model) = defaults.get_mut("model") {
                if let Some(primary) = model.as_object_mut() {
                    primary.insert("primary".into(), Value::String(primary_model.clone()));
                }
            } else if let Some(obj) = defaults.as_object_mut() {
                obj.insert(
                    "model".into(),
                    json!({ "primary": primary_model.clone() }),
                );
            }
        }
        if let Some(list) = agents.get_mut("list") {
            if let Some(arr) = list.as_array_mut() {
                for agent in arr.iter_mut() {
                    if agent.get("id").and_then(|v| v.as_str()) == Some("main") {
                        if let Some(obj) = agent.as_object_mut() {
                            obj.insert("model".into(), Value::String(primary_model.clone()));
                        }
                    }
                }
            }
        }
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;
    crate::openclaw_control::mark_gateway_config_stale(&base);
    Ok(())
}

fn read_managed_env_path() -> Result<PathBuf, String> {
    Ok(managed_openclaw_data_dir()?.join(".env"))
}

fn read_managed_config_value() -> Result<Value, String> {
    let base = managed_openclaw_data_dir()?;
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Ok(Value::Object(Default::default()));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))
}

pub fn uses_bundled_managed_openclaw() -> bool {
    bundled_openclaw_ready()
}

/// env_status 用：中转站发行包不走 `probe_global_openclaw`（可阻塞 8s+），避免 IPC 超时。
fn bundled_managed_for_env_status() -> bool {
    if crate::distribution_policy::api_key_locked() {
        return bundled_openclaw_ready() || crate::openclaw_runtime::bundled_install_available();
    }
    uses_bundled_managed_openclaw()
}

fn relay_key_fingerprint(key: &str) -> String {
    let t = key.trim();
    if t.len() < 10 {
        return "invalid".into();
    }
    format!(
        "{}…{} (len={})",
        &t[..6.min(t.len())],
        &t[t.len().saturating_sub(4)..],
        t.len()
    )
}

/// 中转站发行包：强制把内嵌 API Key 写入 `.env` 并标记网关配置过期（供重启加载）。
pub fn force_resync_embedded_relay_key() -> Result<String, String> {
    if !crate::distribution_policy::api_key_locked() {
        return Err("仅中转站发行版支持密钥同步".into());
    }
    let Some(embedded) = crate::distribution_policy::embedded_relay_api_key() else {
        return Err("发行包未内嵌中转站 API Key".into());
    };
    let base = managed_openclaw_data_dir()?;
    let id = crate::distribution_policy::active_distribution_profile().primary_api_env_key();
    let mut updates = HashMap::new();
    updates.insert(id.to_string(), embedded.to_string());
    write_env_updates(&base, &updates)?;
    crate::openclaw_control::mark_gateway_config_stale(&base);
    eprintln!(
        "[YunTuAI] force_resync relay API key -> {}",
        relay_key_fingerprint(embedded)
    );
    Ok(relay_key_fingerprint(embedded))
}

pub fn env_status() -> Result<OpenClawEnvStatus, String> {
    let bundled_managed = bundled_managed_for_env_status();
    let env_path = read_managed_env_path()?;
    let env_raw = if env_path.is_file() {
        fs::read_to_string(&env_path).unwrap_or_default()
    } else {
        String::new()
    };
    let env_map = parse_env_map(&env_raw);
    let cfg = read_managed_config_value()?;
    let key_ids = required_model_env_keys(&cfg);

    let api_key_locked = crate::distribution_policy::api_key_locked();
    let embedded_configured = crate::distribution_policy::embedded_relay_api_key().is_some();

    let mut keys = Vec::new();
    for id in key_ids {
        let mut configured = env_map.get(&id).map(|v| !v.is_empty()).unwrap_or(false);
        if api_key_locked && embedded_configured {
            configured = true;
        }
        let (label, hint) = env_label(&id);
        keys.push(EnvKeyRequirement {
            id: id.clone(),
            label,
            hint,
            configured,
            required: api_env_key_required(&id),
            editable: !api_key_locked,
        });
    }

    if keys.is_empty() {
        let key_id = crate::distribution_policy::active_distribution_profile().primary_api_env_key();
        let (label, hint) = env_label(key_id);
        let mut configured = env_map.get(key_id).map(|v| !v.is_empty()).unwrap_or(false);
        if api_key_locked && embedded_configured {
            configured = true;
        }
        keys.push(EnvKeyRequirement {
            id: key_id.to_string(),
            label,
            hint,
            configured,
            required: api_env_key_required(key_id),
            editable: !api_key_locked,
        });
    }

    // 不要求 bundled 运行时已解压：首次安装时用户应先填 API Key，再启动网关。
    let setup_required = !api_key_locked && !model_provider_setup_satisfied(&env_map);

    keys.sort_by_key(|k| env_key_display_rank(&k.id));

    Ok(OpenClawEnvStatus {
        bundled_managed,
        setup_required,
        api_key_locked,
        keys,
        env_path: env_path.to_string_lossy().to_string(),
    })
}

fn write_env_updates(base: &Path, updates: &HashMap<String, String>) -> Result<(), String> {
    unseal_for_write(base);
    let env_path = base.join(".env");

    // 备份旧 .env 到 vault（写前快照，作为写失败时的安全网）
    if env_path.is_file() {
        let _ = backup_to_vault(base, ".env");
    }

    let mut map = if env_path.is_file() {
        fs::read_to_string(&env_path)
            .map_err(|e| e.to_string())
            .map(|raw| parse_env_map(&raw))?
    } else {
        HashMap::new()
    };
    for (k, v) in updates {
        if v.trim().is_empty() {
            map.remove(k);
        } else {
            map.insert(k.clone(), v.clone());
        }
    }

    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort();
    let mut lines = vec!["# YunTuAI 本机服务环境变量（由应用写入，请勿把密钥写在注释行里）".to_string()];
    for key in keys {
        if let Some(val) = map.get(&key) {
            lines.push(format!("{key}={val}"));
        }
    }
    #[cfg(windows)]
    let body = format!("{}\r\n", lines.join("\r\n"));
    #[cfg(not(windows))]
    let body = format!("{}\n", lines.join("\n"));
    fs::write(&env_path, body).map_err(|e| format!("写入 .env: {e}"))?;

    // vault 同步必须在 manifest env_hash 更新前
    if let Err(e) = backup_to_vault(base, ".env") {
        eprintln!("[YunTuAI] vault 同步 .env 失败，1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(base, ".env") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 .env 重试仍失败: {e2}");
        }
    }

    // 更新管控清单的 env_hash，避免看门狗误判漂移
    if let Ok(Some(mut m)) = load_manifest() {
        m.env_hash = hash_env_drift_keys(base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单 env_hash 失败: {e}");
        }
    }

    // 重新封存 .env（只读），防止外部篡改
    seal_config_files(base)?;
    Ok(())
}

pub(crate) fn read_managed_env_map() -> Result<HashMap<String, String>, String> {
    let env_path = read_managed_env_path()?;
    let env_raw = if env_path.is_file() {
        fs::read_to_string(&env_path).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(parse_env_map(&env_raw))
}

pub(crate) fn write_managed_env_values(updates: &HashMap<String, String>) -> Result<(), String> {
    let base = managed_openclaw_data_dir()?;
    write_env_updates(&base, updates)
}

pub fn save_env_keys(updates: HashMap<String, String>) -> Result<OpenClawEnvStatus, String> {
    if updates.is_empty() {
        return Err("未提供任何 API Key".into());
    }

    if crate::distribution_policy::api_key_locked() {
        let primary = crate::distribution_policy::active_distribution_profile().primary_api_env_key();
        if updates.contains_key(primary) {
            return Err("当前发行版已绑定中转站 API Key，无法修改".into());
        }
    }

    let status = env_status()?;
    let allowed: HashSet<_> = status.keys.iter().map(|k| k.id.clone()).collect();
    for key in updates.keys() {
        if !allowed.contains(key) {
            return Err(format!("不允许写入环境变量: {key}"));
        }
        let val = updates.get(key).map(|s| s.trim()).unwrap_or("");
        if val.is_empty() {
            return Err(format!("{key} 不能为空"));
        }
        if val.len() > 512 {
            return Err(format!("{key} 过长"));
        }
    }

    let base = managed_openclaw_data_dir()?;
    let env_path = base.join(".env");
    let mut merged = if env_path.is_file() {
        fs::read_to_string(&env_path)
            .map_err(|e| e.to_string())
            .map(|raw| parse_env_map(&raw))?
    } else {
        HashMap::new()
    };
    for (k, v) in &updates {
        merged.insert(k.clone(), v.clone());
    }
    if !crate::distribution_policy::api_key_locked() && !model_provider_setup_satisfied(&merged) {
        return Err("请至少配置一家模型厂商 API Key".into());
    }

    write_env_updates(&base, &updates)?;
    sync_primary_model_from_env_keys(&merged)?;
    let _ = crate::openclaw_control::sync_model_providers_for_dotenv();
    crate::openclaw_control::mark_gateway_config_stale(&base);
    env_status()
}

/// 修复注释行内误拼接 KEY=value 的 .env（回退/手工编辑后偶发）。
pub(crate) fn normalize_dotenv_file() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let env_path = base.join(".env");
    if !env_path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let needs_fix = raw.lines().any(|l| {
        let t = l.trim();
        t.starts_with('#')
            && t.contains('=')
            && (t.contains("_API_KEY=") || t.contains("_TOKEN=") || t.contains("_URL="))
    });
    if !needs_fix {
        return Ok(false);
    }
    write_env_updates(&base, &HashMap::new())?;
    Ok(true)
}

fn collect_json_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_json_files(&path, out)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("json") {
            out.push(path);
        }
    }
    Ok(())
}

const MACHINE_ENV_WATCH_KEYS: &[&str] = &[
    "OPENCLAW_GATEWAY_TOKEN",
    "MIMO_API_KEY",
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "YUNTUAI_API_KEY",
];

#[cfg(windows)]
fn read_machine_env(key: &str) -> Option<String> {
    let safe = key.replace('\'', "''");
    let script = format!("[Environment]::GetEnvironmentVariable('{safe}','Machine')");
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    crate::openclaw_exec::hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(windows))]
fn read_machine_env(_key: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn read_user_env(key: &str) -> Option<String> {
    let safe = key.replace('\'', "''");
    let script = format!("[Environment]::GetEnvironmentVariable('{safe}','User')");
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-Command", &script]);
    crate::openclaw_exec::hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(windows))]
fn read_user_env(_key: &str) -> Option<String> {
    None
}

#[cfg(windows)]
fn read_windows_env(key: &str) -> Option<String> {
    read_user_env(key)
        .or_else(|| read_machine_env(key))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(windows))]
fn read_windows_env(key: &str) -> Option<String> {
    read_machine_env(key)
}

#[allow(dead_code)]
const API_KEY_ENV_IDS: &[&str] = &["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "YUNTUAI_API_KEY"];

fn api_key_env_ids_for_reconcile() -> Vec<&'static str> {
    vec!["DEEPSEEK_API_KEY", "DASHSCOPE_API_KEY", "YUNTUAI_API_KEY"]
}

/// 中转站发行包内嵌 Key 不可被 Windows 环境变量或兄弟目录 .env 覆盖。
fn is_locked_primary_api_env_key(key: &str) -> bool {
    crate::distribution_policy::api_key_locked()
        && crate::distribution_policy::active_distribution_profile().primary_api_env_key() == key
}

/// 将 Windows 用户/系统环境变量中的 API Key 同步到 openclaw-data/.env（Roaming/Local 分叉时常见）。
fn reconcile_dotenv_with_windows_env() -> Result<bool, String> {
    let base = managed_openclaw_data_dir()?;
    let env_path = base.join(".env");
    if !env_path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let dot = parse_env_map(&raw);
    let mut updates = HashMap::new();
    for key in api_key_env_ids_for_reconcile() {
        if is_locked_primary_api_env_key(key) {
            continue;
        }
        let Some(win) = read_windows_env(key) else {
            continue;
        };
        if dot.get(key).map(|s| s.as_str()) == Some(win.as_str()) {
            continue;
        }
        updates.insert(key.to_string(), win);
    }
    if updates.is_empty() {
        return Ok(false);
    }
    eprintln!(
        "[YunTuAI] reconcile openclaw-data/.env API keys from Windows env: {:?}",
        updates.keys().collect::<Vec<_>>()
    );
    write_env_updates(&base, &updates)?;
    Ok(true)
}

fn sibling_openclaw_data_dir() -> Option<PathBuf> {
    let current = managed_openclaw_data_dir().ok()?;
    let local = dirs::data_local_dir()?.join("YunTuAI").join("openclaw-data");
    let roaming = dirs::data_dir()?.join("YunTuAI").join("openclaw-data");
    if current == local && roaming.is_dir() {
        Some(roaming)
    } else if current == roaming && local.is_dir() {
        Some(local)
    } else {
        None
    }
}

/// Local/Roaming 双份数据时，从另一份安装目录取较新的 API Key 写入当前 .env。
fn reconcile_dotenv_from_sibling_api_keys() -> Result<bool, String> {
    let Some(sibling) = sibling_openclaw_data_dir() else {
        return Ok(false);
    };
    let sibling_env = sibling.join(".env");
    if !sibling_env.is_file() {
        return Ok(false);
    }
    let base = managed_openclaw_data_dir()?;
    let env_path = base.join(".env");
    let current_raw = if env_path.is_file() {
        fs::read_to_string(&env_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let current = parse_env_map(&current_raw);
    let sibling_map = parse_env_map(
        &fs::read_to_string(&sibling_env).map_err(|e| e.to_string())?,
    );
    let sibling_newer = sibling_env
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .zip(
            env_path
                .metadata()
                .and_then(|m| m.modified())
                .ok(),
        )
        .map(|(s, c)| s > c)
        .unwrap_or(false);

    let mut updates = HashMap::new();
    for key in api_key_env_ids_for_reconcile() {
        if is_locked_primary_api_env_key(key) {
            continue;
        }
        let Some(sib_val) = sibling_map.get(key).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let cur_val = current.get(key).map(|s| s.as_str()).unwrap_or("");
        if cur_val == sib_val {
            continue;
        }
        // 已有 Windows 用户/系统环境变量时以之为准，不覆盖
        if read_windows_env(key).is_some() {
            continue;
        }
        // 当前为空，或兄弟目录 .env 更新且值不同
        if cur_val.is_empty() || sibling_newer {
            updates.insert(key.to_string(), sib_val.to_string());
        }
    }
    if updates.is_empty() {
        return Ok(false);
    }
    eprintln!(
        "[YunTuAI] reconcile openclaw-data/.env API keys from sibling install: {:?}",
        updates.keys().collect::<Vec<_>>()
    );
    write_env_updates(&base, &updates)?;
    Ok(true)
}

/// 内置 OpenClaw 可用时默认使用 bundled，避免全局 openclaw 与 YunTuAI 数据目录分叉。
pub fn ensure_bundled_runtime_when_available() -> bool {
    if !bundled_openclaw_ready() && !crate::openclaw_runtime::bundled_install_available() {
        return false;
    }
    let Ok(Some(pref)) = crate::openclaw_runtime::load_runtime_preference() else {
        let _ = crate::openclaw_runtime::save_runtime_preference(RuntimeSource::Bundled);
        return true;
    };
    if !matches!(pref, RuntimeSource::Global) {
        return false;
    }
    let _ = crate::openclaw_runtime::save_runtime_preference(RuntimeSource::Bundled);
    eprintln!("[YunTuAI] runtime preference global → bundled (YunTuAI managed install)");
    true
}
pub fn machine_env_conflicts_with_dotenv() -> bool {
    compute_machine_env_conflicts()
}

fn compute_machine_env_conflicts() -> bool {
    let Ok(base) = managed_openclaw_data_dir() else {
        return false;
    };
    let env_path = base.join(".env");
    let Ok(raw) = fs::read_to_string(&env_path) else {
        return false;
    };
    let dot = parse_env_map(&raw);
    for key in MACHINE_ENV_WATCH_KEYS {
        let Some(file_val) = dot.get(*key).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let Some(env_val) = read_windows_env(key) else {
            continue;
        };
        if env_val.trim() != file_val {
            static LOGGED: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                eprintln!(
                    "[YunTuAI] Windows env {key} conflicts with openclaw-data/.env — supervised spawns use .env"
                );
            }
            return true;
        }
    }
    false
}

/// 网关启动前：去 BOM、修复配置、确保 YunTuAI 策略字段（allowedOrigins / deviceAuth 等）已写入。
pub fn prepare_gateway_runtime_env() -> Result<bool, String> {
    static LAST_PREPARE_MS: AtomicU64 = AtomicU64::new(0);
    const CACHE_MS: u64 = 30_000;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_PREPARE_MS.load(Ordering::Relaxed);
    if now_ms.saturating_sub(last) < CACHE_MS
        && !crate::openclaw_control::peek_gateway_config_stale()
    {
        // 缓存只表示「这 30 秒不用再改盘」。不能把上次的 changed=true 再交回去，
        // 否则 ensure 会把健康网关反复当成配置过期并重启。
        return Ok(false);
    }

    let _ = ensure_bundled_runtime_when_available();
    let env_reconciled = reconcile_dotenv_with_windows_env().unwrap_or(false)
        | reconcile_dotenv_from_sibling_api_keys().unwrap_or(false);
    let bom_fixed = normalize_json_bom_files()?;
    let _ = machine_env_conflicts_with_dotenv();
    let providers_synced = crate::openclaw_control::sync_model_providers_for_dotenv().unwrap_or(false);
    let config_repaired = crate::openclaw_control::repair_openclaw_config_openclaw_compat()?;
    let memory_repaired = crate::openclaw_control::repair_openclaw_memory_recall_on_disk().unwrap_or(false);
    let policy_applied = crate::openclaw_control::apply_yuntuai_policy().unwrap_or(false);
    // 必须在 reconcile 之后执行，确保中转站内嵌 Key 不被 Windows / 兄弟 .env 覆盖。
    let key_enforced = ensure_embedded_relay_api_key_on_disk().unwrap_or(false);
    if key_enforced {
        eprintln!("[YunTuAI] enforced embedded relay API key in openclaw-data/.env");
    }
    let changed = env_reconciled || bom_fixed > 0 || providers_synced || config_repaired || memory_repaired || policy_applied || key_enforced;
    LAST_PREPARE_MS.store(now_ms, Ordering::Relaxed);
    Ok(changed)
}

/// 去除 openclaw-data 下 JSON 文件的 UTF-8 BOM（PowerShell 手工编辑后偶发，会导致 OpenClaw 网关解析失败）。
pub(crate) fn normalize_json_bom_files() -> Result<usize, String> {
    let base = managed_openclaw_data_dir()?;
    let mut files = Vec::new();
    collect_json_files(&base, &mut files)?;
    let mut fixed = 0usize;
    for path in files {
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if !raw.starts_with('\u{FEFF}') {
            continue;
        }
        let stripped = strip_bom(&raw);
        if !stripped.trim().is_empty() {
            serde_json::from_str::<Value>(stripped)
                .map_err(|e| format!("{}: {e}", path.display()))?;
        }
        fs::write(&path, stripped).map_err(|e| e.to_string())?;
        fixed += 1;
    }
    Ok(fixed)
}

/// 发行包内嵌中转站 Key 时，写入/强制对齐至 `.env`。
pub(crate) fn ensure_embedded_relay_api_key_on_disk() -> Result<bool, String> {
    let Some(embedded) = crate::distribution_policy::embedded_relay_api_key() else {
        return Ok(false);
    };
    let base = managed_openclaw_data_dir()?;
    let env_path = base.join(".env");
    let mut map = if env_path.is_file() {
        fs::read_to_string(&env_path)
            .map_err(|e| e.to_string())
            .map(|raw| parse_env_map(&raw))?
    } else {
        HashMap::new()
    };
    if !crate::distribution_policy::ensure_embedded_api_key_in_env(&mut map) {
        return Ok(false);
    }
    let id = crate::distribution_policy::active_distribution_profile().primary_api_env_key();
    let mut updates = HashMap::new();
    updates.insert(id.to_string(), embedded.to_string());
    write_env_updates(&base, &updates)?;
    crate::openclaw_control::mark_gateway_config_stale(&base);
    Ok(true)
}

/// 中转站：每次应用启动首次 ensure 前标记网关配置过期，强制子进程重读 `.env`。
/// 直连 API 探针 200 但经网关 403 时，多为旧 node 进程仍持有过期密钥。
pub fn poke_relay_gateway_env_reload_on_startup() {
    if !crate::distribution_policy::api_key_locked() {
        return;
    }
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    match ensure_embedded_relay_api_key_on_disk() {
        Ok(true) => {
            eprintln!("[YunTuAI] relay startup: API key changed, gateway marked stale");
        }
        Ok(false) => {}
        Err(e) => eprintln!("[YunTuAI] relay startup: embedded key sync skipped: {e}"),
    }
}

pub fn distribution_profile_info() -> DistributionProfileInfo {
    let profile = crate::distribution_policy::active_distribution_profile();
    DistributionProfileInfo {
        profile: profile.id().to_string(),
        profile_label: profile.display_label().to_string(),
        api_key_locked: crate::distribution_policy::api_key_locked(),
        open_registration: crate::distribution_policy::open_registration(),
        default_model_id: crate::distribution_policy::default_model_short_id().to_string(),
        dev_agnes_enabled: crate::distribution_policy::dev_agnes_enabled(),
    }
}

#[tauri::command]
pub fn openclaw_distribution_profile_cmd() -> DistributionProfileInfo {
    distribution_profile_info()
}

#[tauri::command]
pub async fn openclaw_env_status_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawEnvStatus, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        env_status()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn openclaw_env_save_keys_cmd(
    state: State<'_, DbState>,
    token: String,
    keys: HashMap<String, String>,
) -> Result<OpenClawEnvStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        save_env_keys(keys)
    })
    .await
}

/// 设置默认模型（任何已登录用户可调用，无需 Owner）。
/// 写入服务配置文件 的 agents.defaults.model.primary 与 agents.list[0].model。
/// 同时同步更新到 vault + 管控清单。
#[tauri::command]
pub async fn openclaw_env_set_model(
    state: State<'_, DbState>,
    token: String,
    model_id: String,
) -> Result<(), String> {
    use crate::auth::assert_authenticated;

    assert_authenticated(&state, &token)?;
    crate::ipc::run_blocking(move || apply_default_model(model_id)).await
}

fn apply_default_model(model_id: String) -> Result<(), String> {
    use crate::openclaw_control::{
        backup_to_vault, hash_config_files, load_manifest, managed_openclaw_data_dir,
        save_manifest, seal_config_files, unseal_for_write,
    };
    use crate::openclaw_runtime::strip_bom;
    use serde_json::json;

    let model_id = model_id.trim().to_string();
    if model_id.is_empty() {
        return Err("模型 ID 不能为空".into());
    }
    if crate::distribution_policy::api_key_locked()
        && !crate::distribution_policy::is_relay_catalog_model(&model_id)
    {
        return Err("只能使用中转站已上架的模型".into());
    }
    let primary_model = crate::distribution_policy::qualify_model_id(&model_id);

    let base = managed_openclaw_data_dir()?;
    unseal_for_write(&base);
    let path = base.join("openclaw.json");
    if !path.is_file() {
        return Err("服务配置文件不存在".into());
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value =
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?;

    // 更新 agents.defaults.model.primary
    if let Some(agents) = root.get_mut("agents") {
        if let Some(defaults) = agents.get_mut("defaults") {
            if let Some(model) = defaults.get_mut("model") {
                if let Some(primary) = model.as_object_mut() {
                    primary.insert("primary".into(), Value::String(primary_model.clone()));
                }
            } else {
                defaults
                    .as_object_mut()
                    .map(|o| o.insert("model".into(), json!({ "primary": primary_model.clone() })));
            }
        }
        // 更新 agents.list[0].model
        if let Some(list) = agents.get_mut("list") {
            if let Some(arr) = list.as_array_mut() {
                if let Some(first) = arr.first_mut() {
                    if let Some(obj) = first.as_object_mut() {
                        obj.insert("model".into(), Value::String(primary_model));
                    }
                }
            }
        }
    }

    backup_to_vault(&base, "openclaw.json")?;
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, &out).map_err(|e| e.to_string())?;

    // vault 同步必须在 manifest hash 更新前
    if let Err(e) = backup_to_vault(&base, "openclaw.json") {
        eprintln!("[YunTuAI] vault 同步 openclaw.json 失败（set_model），1s 后重试: {e}");
        std::thread::sleep(std::time::Duration::from_secs(1));
        if let Err(e2) = backup_to_vault(&base, "openclaw.json") {
            eprintln!("[YunTuAI] CRITICAL: vault 同步 openclaw.json 重试仍失败: {e2}");
        }
    }

    if let Ok(Some(mut m)) = load_manifest() {
        m.config_hashes = hash_config_files(&base);
        if let Err(e) = save_manifest(&m) {
            eprintln!("[YunTuAI] 保存管控清单失败（set_model）: {e}");
        }
    }
    seal_config_files(&base)?;
    crate::openclaw_control::mark_gateway_config_stale(&base);
    Ok(())
}

/// 读取当前默认模型 ID（任何已登录用户可调用）。
#[tauri::command]
pub async fn openclaw_env_get_model(
    state: State<'_, DbState>,
    token: String,
) -> Result<String, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let base = managed_openclaw_data_dir()?;
        let path = base.join("openclaw.json");
        if !path.is_file() {
            return Ok(crate::distribution_policy::short_model_id(
                crate::distribution_policy::active_distribution_profile().primary_model(),
            ));
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let root: Value =
            serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?;
        let model = root
            .get("agents")
            .and_then(|a| a.get("defaults"))
            .and_then(|d| d.get("model"))
            .and_then(|m| m.get("primary"))
            .and_then(|p| p.as_str())
            .unwrap_or_else(|| {
                crate::distribution_policy::active_distribution_profile().primary_model()
            });
        Ok(crate::distribution_policy::short_model_id(model))
    })
    .await
}

/// 当前发行档可选模型列表（供设置页展示）。
#[tauri::command]
pub async fn openclaw_env_list_models(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<EnvModelOption>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let mut models: Vec<EnvModelOption> = crate::distribution_policy::available_models()
            .iter()
            .map(|(id, label)| EnvModelOption {
                id: (*id).to_string(),
                label: (*label).to_string(),
            })
            .collect();
        if !crate::distribution_policy::api_key_locked() {
        if let Ok(env_map) = read_managed_env_map() {
            for (id, label) in crate::llm_user_providers::extra_available_models(&env_map) {
                if !models.iter().any(|m| m.id == id) {
                    models.push(EnvModelOption { id, label });
                }
            }
        }
        }
        Ok(models)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvModelOption {
    pub id: String,
    pub label: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collects_env_api_key_ids_from_config() {
        let cfg = json!({
            "models": {
                "providers": {
                    "yuntuai": {
                        "apiKey": { "source": "env", "id": "YUNTUAI_API_KEY" }
                    }
                }
            }
        });
        let ids = required_model_env_keys(&cfg);
        assert!(ids.contains(&"YUNTUAI_API_KEY".to_string()));
    }

    #[test]
    fn collects_dashscope_from_qwen_provider_config() {
        let cfg = json!({
            "models": {
                "providers": {
                    "qwen": {
                        "apiKey": { "source": "env", "id": "DASHSCOPE_API_KEY" }
                    }
                }
            }
        });
        let ids = required_model_env_keys(&cfg);
        assert!(ids.contains(&"DASHSCOPE_API_KEY".to_string()));
    }

    #[test]
    fn direct_profile_model_keys_not_individually_required() {
        assert!(!api_env_key_required("MIMO_API_KEY"));
        assert!(!api_env_key_required("DASHSCOPE_API_KEY"));
        assert!(!api_env_key_required("DEEPSEEK_API_KEY"));
    }

    #[test]
    fn model_provider_setup_accepts_any_vendor_key() {
        let empty = HashMap::new();
        assert!(!model_provider_setup_satisfied(&empty));
        let mut only_qwen = HashMap::new();
        only_qwen.insert("DASHSCOPE_API_KEY".into(), "sk-test".into());
        assert!(model_provider_setup_satisfied(&only_qwen));
        let mut only_deepseek = HashMap::new();
        only_deepseek.insert("DEEPSEEK_API_KEY".into(), "sk-test".into());
        assert!(model_provider_setup_satisfied(&only_deepseek));
        let mut only_mimo = HashMap::new();
        only_mimo.insert("MIMO_API_KEY".into(), "sk-test".into());
        assert!(model_provider_setup_satisfied(&only_mimo));
        let mut all = HashMap::new();
        all.insert("MIMO_API_KEY".into(), "sk-m".into());
        all.insert("DEEPSEEK_API_KEY".into(), "sk-a".into());
        all.insert("DASHSCOPE_API_KEY".into(), "sk-b".into());
        assert!(model_provider_setup_satisfied(&all));
    }

    #[test]
    fn parse_env_map_recovers_key_embedded_in_comment_line() {
        let raw = "# merged from old config DEEPSEEK_API_KEY=sk-test123\nOPENCLAW_GATEWAY_TOKEN=abc\n";
        let map = parse_env_map(raw);
        assert_eq!(map.get("DEEPSEEK_API_KEY").map(String::as_str), Some("sk-test123"));
        assert_eq!(map.get("OPENCLAW_GATEWAY_TOKEN").map(String::as_str), Some("abc"));
    }
}
