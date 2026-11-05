//! 跨版本升级对账：1.3.7 / 1.3.9 → 1.4.0 等覆盖安装后，首次启动自动修复常见残留问题。

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::app_launch;
use crate::paths;

const VERSION_FILE: &str = "app-last-version.txt";
const NOTICE_FILE: &str = "upgrade-notice-pending.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpgradeNotice {
    pub from_version: Option<String>,
    pub to_version: String,
    pub hints: Vec<String>,
}

static PENDING_NOTICE: Mutex<Option<UpgradeNotice>> = Mutex::new(None);

fn version_file_path() -> Result<PathBuf, String> {
    Ok(paths::data_dir()?.join(VERSION_FILE))
}

fn notice_file_path() -> Result<PathBuf, String> {
    Ok(paths::data_dir()?.join(NOTICE_FILE))
}

fn read_last_version() -> Option<String> {
    let path = version_file_path().ok()?;
    let raw = fs::read_to_string(path).ok()?;
    let v = raw.trim();
    if v.is_empty() {
        None
    } else {
        Some(v.to_string())
    }
}

fn write_last_version(version: &str) -> Result<(), String> {
    let path = version_file_path()?;
    fs::write(path, format!("{version}\n")).map_err(|e| e.to_string())
}

fn parse_major_minor_patch(v: &str) -> Option<(u32, u32, u32)> {
    let mut parts = v.trim().split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

fn is_upgrade_from_legacy_13x(from: &str) -> bool {
    match parse_major_minor_patch(from) {
        Some((1, minor, _)) if minor < 4 => true,
        Some((0, _, _)) => true,
        _ => from.starts_with("1.3."),
    }
}

/// 将旧版「启动」文件夹 bat 重命名为 .disabled，避免与 1.4 正式 `--tray` 自启冲突。
fn disable_legacy_startup_bat() -> bool {
    #[cfg(windows)]
    {
        let startup = dirs::config_dir().map(|d| {
            d.join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Startup")
                .join("YunTuAI-AutoStart.bat")
        });
        let Some(path) = startup.filter(|p| p.is_file()) else {
            return false;
        };
        let disabled = path.with_extension("bat.disabled-by-yuntuai");
        if disabled.is_file() {
            let _ = fs::remove_file(&path);
            return true;
        }
        match fs::rename(&path, &disabled) {
            Ok(()) => {
                eprintln!(
                    "[YunTuAI upgrade] disabled legacy startup bat: {} -> {}",
                    path.display(),
                    disabled.display()
                );
                true
            }
            Err(e) => {
                eprintln!("[YunTuAI upgrade] could not rename legacy startup bat: {e}");
                false
            }
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn reconcile_stuck_running_tasks(conn: &Connection) -> u32 {
    let now = crate::db::now_iso();
    match conn.execute(
        "UPDATE local_tasks SET status = 'interrupted', updated_at = ?1 WHERE status = 'running'",
        rusqlite::params![now],
    ) {
        Ok(n) => n as u32,
        Err(e) => {
            eprintln!("[YunTuAI upgrade] stuck task reconcile: {e}");
            0
        }
    }
}

fn build_hints(
    from: Option<&str>,
    to_version: &str,
    legacy_bat: bool,
    stuck_tasks: u32,
) -> Vec<String> {
    let mut hints = Vec::new();
    let from_legacy = from.map(is_upgrade_from_legacy_13x).unwrap_or(false);

    if from_legacy {
        hints.push(format!(
            "已从 1.3.x 升级至 {to_version}：账户、对话与本机服务数据已保留，无需重新注册。"
        ));
        hints.push(
            "若曾遇「连接拒绝」或办事超时，本版已加强启动连接与任务稳定性；建议重启一次后正常使用。".into(),
        );
    }

    if legacy_bat {
        hints.push(
            "已自动禁用旧版开机脚本 YunTuAI-AutoStart.bat（易与新版冲突）。请在「设置 → 软件启动」中重新开启正式自启。".into(),
        );
    } else if from_legacy && app_launch::legacy_startup_bat_exists() {
        hints.push(
            "检测到「启动」文件夹中仍有 YunTuAI-AutoStart.bat，请手动删除或在设置中改用正式开机自启。".into(),
        );
    }

    if stuck_tasks > 0 {
        hints.push(format!(
            "已将 {stuck_tasks} 个升级前未收尾的「进行中」任务标记为中断，可在对话中点「重试发送」续办。"
        ));
    }

    hints.push("图片与表格附件现默认走内置 OCR；Excel 会在本地预提取，长任务超时上限已提高。".into());

    hints
}

fn persist_notice(notice: &UpgradeNotice) {
    if let Ok(path) = notice_file_path() {
        if let Ok(json) = serde_json::to_string(notice) {
            let _ = fs::write(path, json);
        }
    }
    if let Ok(mut g) = PENDING_NOTICE.lock() {
        *g = Some(notice.clone());
    }
}

fn load_persisted_notice() -> Option<UpgradeNotice> {
    let path = notice_file_path().ok()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn clear_persisted_notice() {
    if let Ok(path) = notice_file_path() {
        let _ = fs::remove_file(path);
    }
}

/// 启动时调用：对比上次运行版本，执行一次性对账并生成用户提示（若有）。
pub fn reconcile_on_startup(conn: &Connection) -> Option<UpgradeNotice> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let previous = read_last_version();

    if previous.as_deref() == Some(current.as_str()) {
        if let Some(n) = load_persisted_notice() {
            if let Ok(mut g) = PENDING_NOTICE.lock() {
                *g = Some(n);
            }
        }
        return None;
    }

    let from_legacy = previous
        .as_deref()
        .map(is_upgrade_from_legacy_13x)
        .unwrap_or(false);

    if previous.is_some() {
        eprintln!(
            "[YunTuAI upgrade] version change: {:?} -> {}",
            previous, current
        );
    }

    let legacy_bat_disabled = if from_legacy || app_launch::legacy_startup_bat_exists() {
        disable_legacy_startup_bat()
    } else {
        false
    };

    let stuck_tasks = if previous.is_some() {
        reconcile_stuck_running_tasks(conn)
    } else {
        0
    };

    let _ = crate::service_config_repair::repair_service_config(false);
    let _ = crate::openclaw_env::prepare_gateway_runtime_env();

    let notice = UpgradeNotice {
        from_version: previous.clone(),
        to_version: current.clone(),
        hints: if previous.is_some() {
            build_hints(previous.as_deref(), &current, legacy_bat_disabled, stuck_tasks)
        } else {
            Vec::new()
        },
    };

    if let Err(e) = write_last_version(&current) {
        eprintln!("[YunTuAI upgrade] write version file: {e}");
    }

    if previous.is_some() && !notice.hints.is_empty() {
        persist_notice(&notice);
        Some(notice)
    } else {
        clear_persisted_notice();
        None
    }
}

#[tauri::command]
pub fn yuntuai_consume_upgrade_notice() -> Option<UpgradeNotice> {
    if let Ok(mut g) = PENDING_NOTICE.lock() {
        if let Some(n) = g.take() {
            clear_persisted_notice();
            return Some(n);
        }
    }
    if let Some(n) = load_persisted_notice() {
        clear_persisted_notice();
        return Some(n);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_legacy_13x() {
        assert!(is_upgrade_from_legacy_13x("1.3.7"));
        assert!(is_upgrade_from_legacy_13x("1.3.9"));
        assert!(!is_upgrade_from_legacy_13x("1.4.0"));
    }
}
