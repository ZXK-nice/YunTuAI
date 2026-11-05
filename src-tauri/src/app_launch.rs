//! 启动模式：开机自启（`--tray` 后台）、主窗口显示/隐藏。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const TRAY_LAUNCH_ARG: &str = "--tray";

/// 系统刚开机时额外等待，避免登录自启与磁盘/杀软争抢导致网关起不来。
const FRESH_BOOT_UPTIME_MS: u64 = 180_000;
const TRAY_BASE_DELAY_MS: u64 = 800;
const TRAY_FRESH_BOOT_EXTRA_MS: u64 = 12_000;
const NORMAL_BASE_DELAY_MS: u64 = 200;
const NORMAL_FRESH_BOOT_EXTRA_MS: u64 = 4_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchContext {
    pub tray_mode: bool,
    pub fresh_system_boot: bool,
    pub legacy_startup_bat: bool,
    pub startup_grace_ms: u64,
}

pub fn launch_in_tray_mode() -> bool {
    std::env::args().any(|a| a == TRAY_LAUNCH_ARG)
}

pub fn system_uptime_ms() -> u64 {
    #[cfg(windows)]
    {
        extern "system" {
            fn GetTickCount64() -> u64;
        }
        unsafe { GetTickCount64() }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

pub fn is_fresh_system_boot() -> bool {
    system_uptime_ms() < FRESH_BOOT_UPTIME_MS
}

/// Windows「启动」文件夹里旧版 YunTuAI-AutoStart.bat（无 `--tray`）会与正式自启冲突。
pub fn legacy_startup_bat_exists() -> bool {
    #[cfg(windows)]
    {
        let startup = dirs::config_dir()
            .map(|d| {
                d.join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Startup")
                    .join("YunTuAI-AutoStart.bat")
            })
            .filter(|p| p.is_file());
        startup.is_some()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn startup_grace_ms() -> u64 {
    let base = if launch_in_tray_mode() { 120_000 } else { 90_000 };
    if is_fresh_system_boot() {
        base + 60_000
    } else {
        base
    }
}

pub fn should_start_with_hidden_window() -> bool {
    launch_in_tray_mode() || legacy_startup_bat_exists()
}

pub fn launch_context() -> LaunchContext {
    LaunchContext {
        tray_mode: launch_in_tray_mode(),
        fresh_system_boot: is_fresh_system_boot(),
        legacy_startup_bat: legacy_startup_bat_exists(),
        startup_grace_ms: startup_grace_ms(),
    }
}

pub fn auto_ensure_initial_delay_ms() -> u64 {
    let base = if launch_in_tray_mode() {
        TRAY_BASE_DELAY_MS
    } else {
        NORMAL_BASE_DELAY_MS
    };
    if is_fresh_system_boot() {
        base + if launch_in_tray_mode() {
            TRAY_FRESH_BOOT_EXTRA_MS
        } else {
            NORMAL_FRESH_BOOT_EXTRA_MS
        }
    } else {
        base
    }
}

pub fn establish_wait_timeout() -> std::time::Duration {
    if cfg!(debug_assertions) {
        return if is_fresh_system_boot() {
            std::time::Duration::from_secs(18)
        } else {
            std::time::Duration::from_secs(12)
        };
    }
    if is_fresh_system_boot() {
        std::time::Duration::from_secs(45)
    } else {
        std::time::Duration::from_secs(30)
    }
}

/// 刚开机时 auto-ensure 失败后二次尝试前的等待。
pub fn auto_ensure_retry_delay() -> std::time::Duration {
    if is_fresh_system_boot() {
        std::time::Duration::from_secs(18)
    } else {
        std::time::Duration::from_secs(8)
    }
}

pub fn should_retry_auto_ensure(health_ok: bool, running: bool) -> bool {
    is_fresh_system_boot() && (!health_ok || !running)
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("yuntuai-main-window-shown", ());
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn yuntuai_launch_context() -> LaunchContext {
    launch_context()
}
