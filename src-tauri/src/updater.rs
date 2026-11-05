//! MSI 覆盖升级：读取远程 `latest.json`，校验 SHA256 后 `/passive` 安装（可见进度、失败可检测）。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::gateway_supervisor::GatewaySupervisor;
use crate::paths;
use serde::Deserialize;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, State};

const PLATFORM_KEY: &str = "windows-x86_64";

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    notes: Option<String>,
    platforms: std::collections::HashMap<String, UpdatePlatform>,
}

#[derive(Debug, Deserialize)]
struct UpdatePlatform {
    url: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub available: bool,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub download_url: Option<String>,
    pub sha256: Option<String>,
    pub error_hint: Option<String>,
}

fn version_gt(latest: &str, current: &str) -> bool {
    fn parts(s: &str) -> [u32; 4] {
        let mut out = [0u32; 4];
        for (i, p) in s.split('.').take(4).enumerate() {
            let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
            out[i] = digits.parse().unwrap_or(0);
        }
        out
    }
    let a = parts(latest);
    let b = parts(current);
    for i in 0..4 {
        if a[i] > b[i] {
            return true;
        }
        if a[i] < b[i] {
            return false;
        }
    }
    false
}

fn fetch_manifest(url: &str) -> Result<UpdateManifest, String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| format!("无法访问更新清单: {e}"))?;
    if resp.status() != 200 {
        return Err(format!("更新清单 HTTP {}", resp.status()));
    }
    let body = resp
        .into_string()
        .map_err(|e| format!("读取更新清单失败: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("更新清单 JSON 无效: {e}"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// MSI 约 100MB+，30s 易超时；读流阶段单独放宽。
fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(600))
        .call()
        .map_err(|e| format!("下载安装包失败: {e}"))?;
    if resp.status() != 200 {
        return Err(format!("下载安装包 HTTP {}", resp.status()));
    }
    let len = resp.header("content-length").and_then(|s| s.parse::<usize>().ok());
    let mut reader = resp.into_reader();
    let mut buf = Vec::new();
    if let Some(cap) = len {
        buf.reserve(cap.min(512 * 1024 * 1024));
    }
    std::io::copy(&mut reader, &mut buf).map_err(|e| format!("读取安装包失败: {e}"))?;
    if buf.is_empty() {
        return Err("安装包为空".into());
    }
    Ok(buf)
}

fn format_install_dir_properties(dir: &Path) -> [String; 2] {
    let mut s = dir.to_string_lossy().into_owned();
    if !s.ends_with('\\') {
        s.push('\\');
    }
    [
        format!("INSTALLFOLDER={s}"),
        format!("INSTALLDIR={s}"),
    ]
}

fn quote_cmd_arg(value: &str) -> String {
    if value.contains(' ') || value.contains('(') || value.contains('&') {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

fn install_drive_letter(dir: &Path) -> Option<String> {
    let s = dir.to_string_lossy();
    let mut chars = s.chars();
    let letter = chars.next()?;
    if chars.next()? != ':' {
        return None;
    }
    Some(format!("{}:", letter.to_ascii_uppercase()))
}

fn write_apply_update_script(
    msi_path: &Path,
    install_dir: &Path,
    log_path: &Path,
) -> Result<PathBuf, String> {
    let props = format_install_dir_properties(install_dir);
    let exe = install_dir.join("YunTuAI.exe");
    let script = std::env::temp_dir().join("YunTuAI-apply-update.cmd");
    let config_msi_prep = match install_drive_letter(install_dir) {
        Some(drive) if !drive.eq_ignore_ascii_case("C:") => format!(
            "if not exist {drive}\\Config.Msi mkdir {drive}\\Config.Msi 2>nul\r\n\
takeown /F {drive}\\Config.Msi /R /D Y >nul 2>&1\r\n\
icacls {drive}\\Config.Msi /grant *S-1-5-32-545:(OI)(CI)F /T >nul 2>&1\r\n\
icacls {drive}\\Config.Msi /grant *S-1-5-32-544:(OI)(CI)F /T >nul 2>&1\r\n\
icacls {drive}\\Config.Msi /grant SYSTEM:(OI)(CI)F /T >nul 2>&1\r\n\
icacls {drive}\\Config.Msi /grant \"%USERNAME%:(OI)(CI)F\" /T >nul 2>&1\r\n",
            drive = drive
        ),
        _ => String::new(),
    };
    let body = format!(
        "@echo off\r\n\
setlocal\r\n\
{config_msi_prep}\
set AUTHDIR=%LOCALAPPDATA%\\YunTuAI-Auth\r\n\
if not exist \"%AUTHDIR%\" mkdir \"%AUTHDIR%\" >nul 2>&1\r\n\
if not exist \"%AUTHDIR%\\data\" mkdir \"%AUTHDIR%\\data\" >nul 2>&1\r\n\
taskkill /F /IM YunTuAI.exe >nul 2>&1\r\n\
timeout /t 2 /nobreak >nul\r\n\
if exist {lic} copy /Y {lic} \"%AUTHDIR%\\license.dat\" >nul 2>&1\r\n\
if exist {db} copy /Y {db} \"%AUTHDIR%\\data\\yuntuai.db\" >nul 2>&1\r\n\
if exist {dbwal} copy /Y {dbwal} \"%AUTHDIR%\\data\\yuntuai.db-wal\" >nul 2>&1\r\n\
if exist {dbshm} copy /Y {dbshm} \"%AUTHDIR%\\data\\yuntuai.db-shm\" >nul 2>&1\r\n\
msiexec /i {msi} /passive /norestart {folder} {dir} /L*v {log}\r\n\
if errorlevel 1 (\r\n\
  echo MSI upgrade failed. See {log} > \"%TEMP%\\YunTuAI-update-failed.txt\"\r\n\
  exit /b 1\r\n\
)\r\n\
if exist \"%AUTHDIR%\\license.dat\" copy /Y \"%AUTHDIR%\\license.dat\" {lic} >nul 2>&1\r\n\
if exist \"%AUTHDIR%\\data\\yuntuai.db\" (\r\n\
  if not exist {dataDir} mkdir {dataDir} >nul 2>&1\r\n\
  if exist {db} del /F /Q {db} >nul 2>&1\r\n\
  if exist {dbwal} del /F /Q {dbwal} >nul 2>&1\r\n\
  if exist {dbshm} del /F /Q {dbshm} >nul 2>&1\r\n\
  copy /Y \"%AUTHDIR%\\data\\yuntuai.db\" {db} >nul 2>&1\r\n\
  if errorlevel 1 (\r\n\
    echo DB restore failed. Backup remains in %AUTHDIR%\\data > \"%TEMP%\\YunTuAI-update-failed.txt\"\r\n\
    exit /b 1\r\n\
  )\r\n\
  if not exist {db} (\r\n\
    echo DB restore missing after copy > \"%TEMP%\\YunTuAI-update-failed.txt\"\r\n\
    exit /b 1\r\n\
  )\r\n\
  if exist \"%AUTHDIR%\\data\\yuntuai.db-wal\" copy /Y \"%AUTHDIR%\\data\\yuntuai.db-wal\" {dbwal} >nul 2>&1\r\n\
  if exist \"%AUTHDIR%\\data\\yuntuai.db-shm\" copy /Y \"%AUTHDIR%\\data\\yuntuai.db-shm\" {dbshm} >nul 2>&1\r\n\
)\r\n\
if exist {exe} start \"\" /D {inst} {exe}\r\n\
endlocal\r\n",
        config_msi_prep = config_msi_prep,
        msi = quote_cmd_arg(&msi_path.to_string_lossy()),
        folder = props[0],
        dir = props[1],
        log = quote_cmd_arg(&log_path.to_string_lossy()),
        exe = quote_cmd_arg(&exe.to_string_lossy()),
        inst = quote_cmd_arg(&install_dir.to_string_lossy()),
        lic = quote_cmd_arg(&install_dir.join("license.dat").to_string_lossy()),
        db = quote_cmd_arg(&install_dir.join("data").join("yuntuai.db").to_string_lossy()),
        dbwal = quote_cmd_arg(&install_dir.join("data").join("yuntuai.db-wal").to_string_lossy()),
        dbshm = quote_cmd_arg(&install_dir.join("data").join("yuntuai.db-shm").to_string_lossy()),
        dataDir = quote_cmd_arg(&install_dir.join("data").to_string_lossy()),
    );
    fs::write(&script, body).map_err(|e| format!("无法写入更新脚本: {e}"))?;
    Ok(script)
}

fn launch_msi_installer(
    msi_path: &Path,
    install_dir: Option<&Path>,
) -> Result<(), String> {
    let install_dir = install_dir.ok_or_else(|| "无法解析当前安装目录".to_string())?;
    let log_path = std::env::temp_dir().join("YunTuAI-update-install.log");
    let script = write_apply_update_script(msi_path, install_dir, &log_path)?;

    // 独立最小化窗口执行：/passive 显示进度；失败不写失败标记时不拉起旧版 exe
    Command::new("cmd")
        .args([
            "/c",
            "start",
            "/min",
            "",
            script.to_string_lossy().as_ref(),
        ])
        .spawn()
        .map_err(|e| format!("无法启动 MSI 安装程序: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn app_check_update(
    state: State<'_, DbState>,
    token: String,
    manifest_url: String,
    current_version: String,
) -> Result<UpdateCheckResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        Ok(fetch_update_check(manifest_url, current_version))
    })
    .await
}

fn fetch_update_check(manifest_url: String, current_version: String) -> UpdateCheckResult {
    let url = manifest_url.trim();
    if url.is_empty() {
        return UpdateCheckResult {
            current_version: current_version.clone(),
            available: false,
            latest_version: None,
            notes: None,
            download_url: None,
            sha256: None,
            error_hint: Some(
                "未配置更新地址。请在「配置 → 软件更新」填写 latest.json 的 URL。".into(),
            ),
        };
    }
    if !url.to_ascii_lowercase().starts_with("https://") {
        return UpdateCheckResult {
            current_version,
            available: false,
            latest_version: None,
            notes: None,
            download_url: None,
            sha256: None,
            error_hint: Some("更新清单地址须为 HTTPS".into()),
        };
    }

    match fetch_manifest(url) {
        Ok(manifest) => {
            let platform = manifest.platforms.get(PLATFORM_KEY);
            let available = version_gt(&manifest.version, &current_version);
            UpdateCheckResult {
                current_version,
                available,
                latest_version: Some(manifest.version),
                notes: manifest.notes,
                download_url: platform.map(|p| p.url.clone()),
                sha256: platform.map(|p| p.sha256.trim().to_lowercase()),
                error_hint: if available && platform.is_none() {
                    Some("更新清单缺少 windows-x86_64 条目".into())
                } else {
                    None
                },
            }
        }
        Err(e) => UpdateCheckResult {
            current_version,
            available: false,
            latest_version: None,
            notes: None,
            download_url: None,
            sha256: None,
            error_hint: Some(e),
        },
    }
}

/// 仅允许 HTTPS 下载，降低本地恶意 invoke 风险。
fn assert_https_download_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return Err("仅支持 HTTPS 下载地址".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn app_install_msi_update(
    app: AppHandle,
    sup: State<'_, GatewaySupervisor>,
    state: State<'_, DbState>,
    token: String,
    download_url: String,
    expected_sha256: String,
    version_label: Option<String>,
) -> Result<(), String> {
    let conn = state.conn.clone();
    let msi_path = crate::ipc::run_blocking(move || {
        crate::owner::assert_owner_mutex(&conn, &token)?;
        stage_verified_msi(download_url, expected_sha256, version_label)
    })
    .await?;
    sup.shutdown_on_app_exit();
    let install_dir = paths::installed_dir().ok();
    launch_msi_installer(&msi_path, install_dir.as_deref())?;
    app.exit(0);
    Ok(())
}

fn stage_verified_msi(
    download_url: String,
    expected_sha256: String,
    version_label: Option<String>,
) -> Result<PathBuf, String> {
    let url = download_url.trim();
    if url.is_empty() {
        return Err("下载地址为空".into());
    }
    assert_https_download_url(url)?;
    let expected = expected_sha256.trim().to_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("SHA256 格式无效".into());
    }

    let bytes = download_bytes(url)?;
    let actual = sha256_hex(&bytes);
    if actual != expected {
        return Err(format!(
            "安装包校验失败（SHA256 不匹配）。期望 {expected}，实际 {actual}"
        ));
    }

    let label = version_label
        .as_deref()
        .unwrap_or("latest")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
        .collect::<String>();
    let msi_path = std::env::temp_dir().join(format!("YunTuAI-update-{label}.msi"));
    let mut file = fs::File::create(&msi_path).map_err(|e| format!("无法写入临时 MSI: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("写入临时 MSI 失败: {e}"))?;
    drop(file);
    Ok(msi_path)
}

/// 若上次 MSI 升级失败，返回提示并删除标记文件（一次性消费）。
#[tauri::command]
pub fn app_consume_update_failure_hint(
    state: State<'_, DbState>,
    token: String,
) -> Result<Option<String>, String> {
    assert_authenticated(&state, &token)?;
    let path = std::env::temp_dir().join("YunTuAI-update-failed.txt");
    let content = fs::read_to_string(&path).ok();
    let Some(content) = content else {
        return Ok(None);
    };
    let trimmed = content.trim();
    if trimmed.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(None);
    }
    let _ = fs::remove_file(&path);
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_dir_properties_have_trailing_backslash() {
        let p = Path::new(r"D:\YunTuAI");
        let props = format_install_dir_properties(p);
        assert_eq!(props[0], r"INSTALLFOLDER=D:\YunTuAI\");
        assert_eq!(props[1], r"INSTALLDIR=D:\YunTuAI\");
    }

    #[test]
    fn apply_update_script_body() {
        let msi = Path::new(r"C:\Temp\YunTuAI-update-1.4.0.msi");
        let log = Path::new(r"C:\Temp\YunTuAI-update-install.log");

        let d_inst = Path::new(r"D:\YunTuAI");
        let d_script = write_apply_update_script(msi, d_inst, log).expect("script");
        let d_text = fs::read_to_string(&d_script).expect("read");
        assert!(d_text.contains("/passive"));
        assert!(d_text.contains("if errorlevel 1"));
        assert!(d_text.contains("INSTALLFOLDER=D:\\YunTuAI\\"));
        assert!(d_text.contains("INSTALLDIR=D:\\YunTuAI\\"));
        assert!(d_text.contains(r"D:\Config.Msi"));

        let c_inst = Path::new(r"C:\Users\me\AppData\Local\YunTuAI");
        let c_script = write_apply_update_script(msi, c_inst, log).expect("script");
        let c_text = fs::read_to_string(&c_script).expect("read");
        assert!(!c_text.contains("Config.Msi"));
        let kill_at = c_text.find("taskkill /F /IM YunTuAI.exe").expect("taskkill");
        let db_at = c_text.find("yuntuai.db").expect("db copy");
        assert!(kill_at < db_at);
        assert!(c_text.contains("del /F /Q"));
        assert!(c_text.contains("YunTuAI-Auth"));
        assert!(c_text.contains("license.dat"));
        assert!(c_text.contains("yuntuai.db"));
        assert!(c_text.contains(r"%AUTHDIR%\data"));
    }
}
