//! 统一路径解析 — 所有数据/配置/OpenClaw 都以 exe 所在目录为根。

use std::path::PathBuf;

/// 安装目录（通常是 `%LOCALAPPDATA%\YunTuAI\`），即当前 exe 所在目录。
/// 开发模式下回退到系统数据目录（保持 dev 可用）。
pub(crate) fn installed_dir() -> Result<PathBuf, String> {
    // Release 模式：exe 所在目录
    let exe = std::env::current_exe().map_err(|e| format!("无法获取可执行文件路径: {e}"))?;
    if let Some(dir) = exe.parent() {
        let dir = dir.to_path_buf();
        // 如果目录名不像是开发 target 目录，就用它
        let dir_name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if dir_name != "debug" && dir_name != "release" {
            return Ok(dir);
        }
    }
    // 开发模式回退：在 Local / Roaming 两处 YunTuAI 目录取「较新 yuntuai.db」所在目录，避免 dev 与脚本路径分叉。
    let mut dir = dirs::data_local_dir()
        .ok_or_else(|| "无法解析本地应用数据目录".to_string())?
        .join("YunTuAI");
    if let Some(roaming) = dirs::data_dir() {
        let alt = roaming.join("YunTuAI");
        let local_db = dir.join("data").join("yuntuai.db");
        let roam_db = alt.join("data").join("yuntuai.db");
        let pick_roaming = match (local_db.metadata(), roam_db.metadata()) {
            (Ok(l), Ok(r)) => r.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                > l.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            (Err(_), Ok(_)) => true,
            _ => false,
        };
        if pick_roaming {
            dir = alt;
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// YunTuAI 本地 SQLite 数据目录
pub(crate) fn data_dir() -> Result<PathBuf, String> {
    let dir = installed_dir()?.join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// `yuntuai.db` 完整路径
pub(crate) fn db_file_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("yuntuai.db"))
}

/// OpenClaw 内置便携入口（Windows: .cmd；macOS: .sh）
pub(crate) fn openclaw_exe_path() -> Result<PathBuf, String> {
    Ok(installed_dir()?.join("openclaw-portable").join(crate::openclaw_platform::openclaw_launcher_name()))
}

/// OpenClaw 数据目录（替代 `~/.openclaw`）
pub(crate) fn openclaw_data_dir() -> Result<PathBuf, String> {
    let dir = installed_dir()?.join("openclaw-data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn push_unique_root(roots: &mut Vec<PathBuf>, candidate: PathBuf) {
    let candidate = candidate
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_string();
    let candidate = PathBuf::from(candidate);
    if candidate.as_os_str().is_empty() {
        return;
    }
    if roots.iter().any(|p| p == &candidate) {
        return;
    }
    roots.push(candidate);
}

/// 与安装目录分离的授权备份目录。覆盖升级 / 换安装路径时仍保留 `license.dat` 与账号库。
/// 真正卸载时由 `uninstall-yuntuai-clean.ps1` 删除。
pub(crate) fn durable_auth_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "无法解析本地应用数据目录".to_string())?
        .join("YunTuAI-Auth");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 账号/对话库的耐久副本（`%LOCALAPPDATA%\YunTuAI-Auth\data\yuntuai.db`）。
pub(crate) fn durable_account_db_path() -> Result<PathBuf, String> {
    let dir = durable_auth_dir()?.join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("yuntuai.db"))
}

fn registry_install_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\yuntuai\YunTuAI",
                "/v",
                "InstallDir",
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if !line.contains("InstallDir") {
                continue;
            }
            let marker = "REG_SZ";
            if let Some(idx) = line.find(marker) {
                let path = line[idx + marker.len()..].trim();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
        None
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// 本机可能存在的多套 YunTuAI 安装根目录（当前 exe、注册表、Local/Roaming、授权备份），用于升级后回收用户数据。
pub(crate) fn candidate_install_roots() -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Ok(cur) = installed_dir() {
        push_unique_root(&mut roots, cur);
    }
    if let Some(reg) = registry_install_dir() {
        push_unique_root(&mut roots, reg);
    }
    if let Some(local) = dirs::data_local_dir() {
        push_unique_root(&mut roots, local.join("YunTuAI"));
    }
    if let Some(roaming) = dirs::data_dir() {
        push_unique_root(&mut roots, roaming.join("YunTuAI"));
    }
    if let Ok(auth) = durable_auth_dir() {
        push_unique_root(&mut roots, auth);
    }
    Ok(roots)
}