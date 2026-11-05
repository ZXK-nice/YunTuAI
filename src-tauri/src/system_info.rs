//! 本机运行环境与系统信息（用户手册「系统信息面板」「运行环境检测」）。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::license::machine_fingerprint;
use crate::paths;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheckItem {
    pub id: String,
    pub label: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoReport {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub install_dir: String,
    pub data_dir: String,
    pub openclaw_data_dir: String,
    pub fingerprint: String,
    pub webview2_installed: bool,
    pub runtime_checks: Vec<RuntimeCheckItem>,
}

fn webview2_installed() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let keys = [
            r"HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
            r"HKCU\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ];
        for key in keys {
            let ok = Command::new("reg")
                .args(["query", key, "/v", "pv"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if ok {
                return true;
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        true
    }
}

fn path_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".yuntuai-write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn build_runtime_checks(install_dir: &Path) -> Vec<RuntimeCheckItem> {
    let mut checks = Vec::new();

    let install_writable = path_writable(install_dir);
    checks.push(RuntimeCheckItem {
        id: "install_dir_writable".into(),
        label: "安装目录可写".into(),
        ok: install_writable,
        detail: if install_writable {
            "当前安装目录具备读写权限".into()
        } else {
            "安装目录无法写入，请更换路径或以管理员重试".into()
        },
    });

    let wv2 = webview2_installed();
    checks.push(RuntimeCheckItem {
        id: "webview2".into(),
        label: "WebView2 运行时".into(),
        ok: wv2,
        detail: if wv2 {
            "已检测到 Microsoft Edge WebView2".into()
        } else {
            "未检测到 WebView2，首次安装 MSI 时会自动引导安装".into()
        },
    });

    let openclaw_cmd = install_dir.join("openclaw-portable").join("openclaw.cmd");
    let payload_zip = install_dir
        .join("openclaw-portable")
        .join("openclaw-portable-payload.zip");
    let portable_ok = openclaw_cmd.is_file() && payload_zip.is_file();
    checks.push(RuntimeCheckItem {
        id: "openclaw_portable".into(),
        label: "内置本机服务组件".into(),
        ok: portable_ok,
        detail: if portable_ok {
            "内置运行时已就绪，首次启动将自动解压".into()
        } else {
            "缺少内置运行时文件，请修复安装或重新安装 MSI".into()
        },
    });

    let tess_candidates = [
        install_dir.join("bundled").join("tesseract"),
        install_dir.join("tesseract"),
        install_dir.join("resources").join("tesseract"),
    ];
    let ocr_ok = tess_candidates.iter().any(|dir| {
        dir.join("tesseract.exe").is_file()
            && dir.join("tessdata").join("chi_sim.traineddata").is_file()
            && dir.join("tessdata").join("eng.traineddata").is_file()
    });
    checks.push(RuntimeCheckItem {
        id: "ocr_tessdata".into(),
        label: "内置 OCR 语言包".into(),
        ok: ocr_ok,
        detail: if ocr_ok {
            "chi_sim / eng（tessdata_best）已就绪".into()
        } else {
            "未找到 Tesseract 语言包，图片 OCR 可能不可用".into()
        },
    });

    checks
}

#[tauri::command]
pub fn app_system_info(
    state: tauri::State<'_, DbState>,
    token: String,
) -> Result<SystemInfoReport, String> {
    assert_authenticated(&state, &token)?;
    let install_dir = paths::installed_dir()?;
    let data_dir = paths::data_dir()?;
    let openclaw_data_dir = paths::openclaw_data_dir()?;
    let fingerprint = machine_fingerprint().unwrap_or_default();

    Ok(SystemInfoReport {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        install_dir: install_dir.to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        openclaw_data_dir: openclaw_data_dir.to_string_lossy().into_owned(),
        fingerprint,
        webview2_installed: webview2_installed(),
        runtime_checks: build_runtime_checks(&install_dir),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_checks_include_core_items() {
        let dir = std::env::temp_dir().join("yuntuai-system-info-test");
        let checks = build_runtime_checks(&dir);
        let ids: Vec<_> = checks.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"install_dir_writable"));
        assert!(ids.contains(&"webview2"));
    }
}
