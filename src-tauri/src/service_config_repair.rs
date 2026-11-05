//! 服务配置文件启动前修复编排（浏览器 profile、兼容项、内置诊断）。

use crate::distribution_policy::repair_browser_profiles_in_config;
use crate::openclaw_control::{
    backup_to_vault, managed_openclaw_data_dir, mark_gateway_config_stale, repair_openclaw_config_openclaw_compat,
    unseal_config_files, vault_path,
};
use crate::openclaw_exec::run_openclaw_timed;
use crate::openclaw_runtime::strip_bom;
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfigRepairResult {
    pub changed: bool,
    pub browser_profiles_repaired: bool,
    pub compat_repaired: bool,
    pub doctor_ran: bool,
    pub doctor_ok: bool,
    pub message: String,
}

fn repair_browser_profiles_on_disk(path: &std::path::Path) -> Result<bool, String> {
    if !path.is_file() {
        return Ok(false);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut root: Value =
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?;
    if !repair_browser_profiles_in_config(&mut root) {
        return Ok(false);
    }
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(path, out).map_err(|e| e.to_string())?;
    Ok(true)
}

fn run_service_doctor_fix() -> bool {
    match run_openclaw_timed(&["doctor", "--fix"], Duration::from_secs(90)) {
        Ok(r) => r.ok,
        Err(e) => {
            eprintln!("[YunTuAI] service doctor fix failed: {e}");
            false
        }
    }
}

/// 综合修复：可选 provider 裁剪 → 浏览器 profile → 兼容项 → 可选内置诊断。
pub fn repair_service_config(run_doctor: bool) -> Result<ServiceConfigRepairResult, String> {
    let base = managed_openclaw_data_dir()?;
    unseal_config_files(&base);

    let providers_synced = crate::openclaw_control::sync_model_providers_for_dotenv()?;

    let main_path = base.join("openclaw.json");
    let vault_cfg = vault_path(&base, "openclaw.json");

    let mut browser_repaired = false;
    if main_path.is_file() {
        browser_repaired |= repair_browser_profiles_on_disk(&main_path)?;
    }
    if vault_cfg.is_file() {
        let _ = repair_browser_profiles_on_disk(&vault_cfg);
    }

    let compat_repaired = repair_openclaw_config_openclaw_compat()?;

    let mut doctor_ran = false;
    let mut doctor_ok = false;
    if run_doctor {
        doctor_ran = true;
        doctor_ok = run_service_doctor_fix();
        // doctor 改盘后只标记一次过期；不要让后续 ensure 把「已修复」再当成每轮都要重启。
    }

    if providers_synced || browser_repaired || compat_repaired || doctor_ok {
        let _ = backup_to_vault(&base, "openclaw.json");
        mark_gateway_config_stale(&base);
    }

    let changed = providers_synced || browser_repaired || compat_repaired || doctor_ok;
    let message = if providers_synced {
        "已按当前 API Key 裁剪可选模型配置（未配置的千问/DeepSeek 不再阻塞网关启动）。".into()
    } else if browser_repaired {
        "已修复服务配置文件中的浏览器颜色设置。".into()
    } else if compat_repaired {
        "已修复服务配置文件中的兼容项。".into()
    } else if doctor_ok {
        "已通过内置诊断修复服务配置。".into()
    } else if changed {
        "服务配置已检查，未发现需修复项。".into()
    } else {
        "服务配置已检查。".into()
    };

    Ok(ServiceConfigRepairResult {
        changed,
        browser_profiles_repaired: browser_repaired,
        compat_repaired,
        doctor_ran,
        doctor_ok,
        message,
    })
}

pub fn looks_like_config_schema_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("invalid config")
        || lower.contains("browser.profiles")
        || (lower.contains("failed to start") && lower.contains(".json"))
}

/// 网关启动时 SecretRef 缺失（常见于仅配 MiMo 但 openclaw.json 仍引用千问/DeepSeek）。
pub fn looks_like_gateway_secret_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("secretrefresolutionerror")
        || lower.contains("required secrets are unavailable")
        || lower.contains("missing or empty")
            && (lower.contains("api_key") || lower.contains("_api_key"))
}

#[tauri::command]
pub async fn yuntuai_repair_service_config(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
) -> Result<ServiceConfigRepairResult, String> {
    crate::auth::assert_authenticated(&state, &token)?;
    repair_service_config(true)
}
