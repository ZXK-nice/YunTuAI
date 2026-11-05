//! 用户本机服务运行时：仅 YunTuAI 内置便携版（与系统 PATH 外置安装隔离）。

use crate::openclaw::{bundled_openclaw_ready, probe_global_openclaw};
use crate::openclaw_bootstrap::has_bundled_payload_zip;
use crate::paths;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const RUNTIME_PREF_FILE: &str = "openclaw-runtime.json";
const MEMORY_LIMIT_FILE: &str = "openclaw-gateway-memory.json";
/** 默认 Node.js 最大堆内存（MB）。1024MB 在复杂任务与大上下文时提供充足缓冲，同时兼顾低配机兼容；需要时可到设置中调节（256–4096）。 */
const DEFAULT_MAX_OLD_SPACE_MB: u64 = 1024;
/** 可用物理内存低于该阈值（MB）时，未手动配置则自动降低网关堆上限，减轻 OOM / 整机卡顿。 */
const LOW_RAM_AUTO_TUNE_THRESHOLD_MB: u64 = 4096;
const LOW_RAM_AUTO_TUNE_MB: u64 = 768;
const MEDIUM_RAM_AUTO_TUNE_THRESHOLD_MB: u64 = 6144;
const MEDIUM_RAM_AUTO_TUNE_MB: u64 = 896;
const BUNDLED_VERSION: &str = env!("OPENCLAW_RUNTIME_OPENCLAW_VERSION");

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeSource {
    Bundled,
    Global,
    #[default]
    Auto,
}

impl RuntimeSource {
    pub fn from_str_loose(s: &str) -> Option<Self> {
        match s.trim().to_lowercase().as_str() {
            "bundled" => Some(RuntimeSource::Bundled),
            "global" => Some(RuntimeSource::Global),
            "auto" => Some(RuntimeSource::Auto),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            RuntimeSource::Bundled => "bundled",
            RuntimeSource::Global => "global",
            RuntimeSource::Auto => "auto",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RuntimePreferenceFile {
    #[serde(default)]
    source: Option<RuntimeSource>,
    #[serde(default)]
    chosen_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscover {
    pub choice_required: bool,
    pub global_available: bool,
    pub global_version: Option<String>,
    pub bundled_ready: bool,
    pub bundled_install_available: bool,
    pub bundled_version: String,
    pub runtime_source: Option<String>,
}

fn pref_path() -> Result<PathBuf, String> {
    Ok(crate::paths::openclaw_data_dir()?.join(RUNTIME_PREF_FILE))
}

pub fn load_runtime_preference() -> Result<Option<RuntimeSource>, String> {
    let path = pref_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let raw = strip_bom(&raw);
    let f: RuntimePreferenceFile = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    Ok(f.source)
}

/// 去除 UTF-8 BOM（\u{FEFF}），某些工具（如 PowerShell 5.1 的 Set-Content -Encoding UTF8）会写入 BOM。
pub(crate) fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{FEFF}').unwrap_or(s)
}

pub fn save_runtime_preference(source: RuntimeSource) -> Result<(), String> {
    let path = pref_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let f = RuntimePreferenceFile {
        source: Some(source),
        chosen_at: Some(chrono::Utc::now().to_rfc3339()),
    };
    fs::write(
        &path,
        serde_json::to_string_pretty(&f).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_runtime_preference() -> Result<(), String> {
    let path = pref_path()?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将历史偏好统一为内置版；不再接外置 PATH 运行时。
pub fn reconcile_runtime_preference() {
    let Ok(Some(pref)) = load_runtime_preference() else {
        return;
    };
    if !matches!(pref, RuntimeSource::Bundled) {
        if bundled_openclaw_ready() || bundled_install_available() {
            let _ = save_runtime_preference(RuntimeSource::Bundled);
        } else {
            let _ = clear_runtime_preference();
        }
    }
}

/// 解析实际用于 spawn 网关/CLI 的运行方式：恒为内置版。
pub fn effective_source(_pref: Option<RuntimeSource>) -> RuntimeSource {
    reconcile_runtime_preference();
    RuntimeSource::Bundled
}

/// 首次启动落盘内置版偏好。
pub fn ensure_default_runtime_pref() -> Result<(), String> {
    reconcile_runtime_preference();
    let path = pref_path()?;
    if path.is_file() {
        return Ok(());
    }
    if bundled_openclaw_ready() || bundled_install_available() {
        save_runtime_preference(RuntimeSource::Bundled)
    } else {
        Ok(())
    }
}

pub fn bundled_install_available() -> bool {
    has_bundled_payload_zip()
}

pub fn runtime_available_for(_source: RuntimeSource) -> bool {
    bundled_openclaw_ready()
}

/// 不再展示运行方式选择；自动使用内置版并完成 provision。
pub fn choice_required() -> bool {
    false
}

/// 当前有效运行方式是否使用内置便携版（供管控 manifest 等）。
pub fn prefers_bundled_runtime() -> bool {
    true
}

pub fn runtime_discover() -> RuntimeDiscover {
    reconcile_runtime_preference();
    let (global, global_version) = probe_global_openclaw();
    RuntimeDiscover {
        choice_required: false,
        global_available: global,
        global_version,
        bundled_ready: bundled_openclaw_ready(),
        bundled_install_available: bundled_install_available(),
        bundled_version: BUNDLED_VERSION.to_string(),
        runtime_source: Some(RuntimeSource::Bundled.as_str().to_string()),
    }
}

fn memory_limit_path() -> Result<PathBuf, String> {
    Ok(paths::openclaw_data_dir()?.join(MEMORY_LIMIT_FILE))
}

#[cfg(windows)]
fn available_physical_memory_mb() -> Option<u64> {
    use std::mem;

    #[repr(C)]
    struct MemoryStatusEx {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    extern "system" {
        fn GlobalMemoryStatusEx(lp_buffer: *mut MemoryStatusEx) -> i32;
    }

    let mut status = MemoryStatusEx {
        dw_length: mem::size_of::<MemoryStatusEx>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    // SAFETY: dw_length 已设为结构体大小，符合 GlobalMemoryStatusEx 契约。
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    if ok == 0 {
        return None;
    }
    Some(status.ull_avail_phys / (1024 * 1024))
}

fn default_gateway_memory_limit_mb() -> u64 {
    #[cfg(windows)]
    {
        if let Some(free_mb) = available_physical_memory_mb() {
            if free_mb < LOW_RAM_AUTO_TUNE_THRESHOLD_MB {
                eprintln!(
                    "[YunTuAI] low RAM ({free_mb} MB free): gateway heap default {LOW_RAM_AUTO_TUNE_MB} MB"
                );
                return LOW_RAM_AUTO_TUNE_MB;
            }
            if free_mb < MEDIUM_RAM_AUTO_TUNE_THRESHOLD_MB {
                eprintln!(
                    "[YunTuAI] moderate RAM ({free_mb} MB free): gateway heap default {MEDIUM_RAM_AUTO_TUNE_MB} MB"
                );
                return MEDIUM_RAM_AUTO_TUNE_MB;
            }
        }
    }
    DEFAULT_MAX_OLD_SPACE_MB
}

/** 读取用户设置的网关内存上限（MB），不存在时返回默认值。 */
pub fn read_gateway_memory_limit_mb() -> Result<u64, String> {
    let path = memory_limit_path()?;
    if !path.is_file() {
        return Ok(default_gateway_memory_limit_mb());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: serde_json::Value = serde_json::from_str(strip_bom(&raw)).map_err(|e| e.to_string())?;
    let mb = v
        .get("maxOldSpaceSizeMb")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_MAX_OLD_SPACE_MB);
    Ok(mb.clamp(256, 4096))
}

/** 保存网关内存上限（MB），下次启动网关生效。 */
pub fn save_gateway_memory_limit_mb(mb: u64) -> Result<(), String> {
    let mb = mb.clamp(256, 4096);
    let path = memory_limit_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let value = serde_json::json!({ "maxOldSpaceSizeMb": mb });
    let body = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn openclaw_gateway_memory_limit(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
) -> Result<u64, String> {
    crate::auth::assert_authenticated(&state, &token)?;
    read_gateway_memory_limit_mb()
}

#[tauri::command]
pub fn openclaw_gateway_memory_limit_save(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
    mb: u64,
) -> Result<(), String> {
    crate::auth::assert_authenticated(&state, &token)?;
    save_gateway_memory_limit_mb(mb)
}
