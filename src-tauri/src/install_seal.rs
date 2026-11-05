//! 本机安装封印：首次注册成功后写入 HMAC 封印文件，防止删库/清空 users 后自助注册劫持账户。

use crate::license::{license_activation_secret, machine_fingerprint};
use crate::paths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const SEAL_FILE: &str = ".install-seal";
const SEAL_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct InstallSealFile {
    version: u32,
    fingerprint: String,
    sealed_at_ms: i64,
    signature: String,
}

fn seal_path() -> Result<PathBuf, String> {
    Ok(paths::installed_dir()?.join(SEAL_FILE))
}

fn seal_pepper() -> String {
    license_activation_secret().unwrap_or_else(|_| {
        if cfg!(debug_assertions) {
            "YUNTUAI-DEV-INSTALL-SEAL".to_string()
        } else if let Some(s) = option_env!("YUNTUAI_EMBEDDED_LICENSE_SECRET") {
            format!("{s}:install-seal")
        } else {
            "YUNTUAI-RELEASE-INSTALL-SEAL".to_string()
        }
    })
}

fn sign_seal(fingerprint: &str, sealed_at_ms: i64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(seal_pepper().as_bytes());
    hasher.update(fingerprint.as_bytes());
    hasher.update(SEAL_VERSION.to_le_bytes());
    hasher.update(sealed_at_ms.to_le_bytes());
    hasher.update(b"install-sealed-v1");
    hex::encode(hasher.finalize())
}

fn read_seal_file() -> Result<Option<InstallSealFile>, String> {
    let path = seal_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("无法读取安装封印: {e}"))?;
    let seal: InstallSealFile =
        serde_json::from_str(&raw).map_err(|e| format!("安装封印格式无效: {e}"))?;
    Ok(Some(seal))
}

fn verify_seal(seal: &InstallSealFile) -> Result<bool, String> {
    if seal.version != SEAL_VERSION {
        return Ok(false);
    }
    let fp = machine_fingerprint()?;
    if seal.fingerprint != fp {
        return Ok(false);
    }
    let expected = sign_seal(&seal.fingerprint, seal.sealed_at_ms);
    Ok(seal.signature == expected)
}

/// 本机是否已完成首次注册封印（含签名校验）。
pub fn is_install_sealed() -> bool {
    match read_seal_file() {
        Ok(Some(seal)) => verify_seal(&seal).unwrap_or(false),
        _ => false,
    }
}

/// 已有用户但无封印时（升级旧库）补写封印。
pub fn ensure_install_seal_from_existing_users(user_count: i64) -> Result<(), String> {
    if user_count <= 0 || is_install_sealed() {
        return Ok(());
    }
    write_install_seal()
}

/// 首次注册成功后写入封印。
pub fn write_install_seal() -> Result<(), String> {
    let fp = machine_fingerprint()?;
    let sealed_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let seal = InstallSealFile {
        version: SEAL_VERSION,
        fingerprint: fp.clone(),
        sealed_at_ms,
        signature: sign_seal(&fp, sealed_at_ms),
    };
    let path = seal_path()?;
    let json = serde_json::to_string_pretty(&seal).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("无法写入安装封印: {e}"))?;
    Ok(())
}

/// 开发构建：封印在但 users 为空时清除，避免登录门闸卡死。
pub fn clear_install_seal_if_orphaned(user_count: i64) -> Result<(), String> {
    if !cfg!(debug_assertions) || user_count > 0 || !is_install_sealed() {
        return Ok(());
    }
    let path = seal_path()?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| format!("无法清除安装封印: {e}"))?;
    }
    Ok(())
}

/// 是否允许自助注册（首装未封印，或发行档开放注册且仍有用户槽位）。
pub fn registration_allowed(user_count: i64) -> bool {
    if is_install_sealed() && user_count == 0 {
        return false;
    }
    if user_count > 0 && !crate::distribution_policy::open_registration() {
        return false;
    }
    true
}

pub fn registration_denied_message(user_count: i64) -> &'static str {
    if is_install_sealed() && user_count == 0 {
        "系统已初始化，账户数据异常或被篡改，无法自助注册。请联系管理员或使用备份恢复。"
    } else if user_count > 0 {
        "系统已初始化，注册已关闭，请联系管理员"
    } else {
        "无法注册"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_seal_is_deterministic() {
        let a = sign_seal("abc123", 1);
        let b = sign_seal("abc123", 1);
        assert_eq!(a, b);
        assert_ne!(a, sign_seal("abc123", 2));
    }
}
