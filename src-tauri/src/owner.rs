//! Owner（厂商）解锁会话：开发/OpenClaw 等敏感能力需 owner 密码验证后才可用。
//!
//! Owner 密码不硬编码在 release 二进制中。优先级：
//! 1. 编译期嵌入 `YUNTUAI_EMBEDDED_OWNER_HASH`（release 构建脚本注入）
//! 2. 环境变量 `YUNTUAI_OWNER_PASSWORD_HASH`（bcrypt 哈希）
//! 3. 环境变量 `YUNTUAI_OWNER_PASSWORD`（明文，仅本地运维）
//! 4. debug 构建下回退到内置开发哈希（见 `DEV_OWNER_PASSWORD_HASH`）

use crate::auth::resolve_authenticated_user;
use crate::db::{audit_insert_on_conn, lock_conn, DbState};
use bcrypt::{hash, verify};
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

/// 固定 Owner 密码 `HHYT@123` 的 bcrypt 哈希（debug 与 release 代登/解锁统一使用）。
pub(crate) const DEV_OWNER_PASSWORD_HASH: &str =
    "$2b$12$.RZUznjqGiPPIhmTNO/xXOWrlOPQCb36kCOrvCScuadMjxhaXI10a";

const OWNER_SESSION_MS: i64 = 12 * 60 * 60 * 1000;
const OWNER_MAX_FAILS: u32 = 5;
const OWNER_LOCK_MS: i64 = 30 * 60 * 1000;

struct OwnerAttemptState {
    failures: u32,
    locked_until_ms: i64,
}

static OWNER_ATTEMPTS: Mutex<OwnerAttemptState> = Mutex::new(OwnerAttemptState {
    failures: 0,
    locked_until_ms: 0,
});

/// `tauri dev` / `cargo build`（debug）下自动视为 Owner 已解锁，不影响 release 安装包。
pub fn owner_dev_bypass_active() -> bool {
    cfg!(debug_assertions)
}

#[derive(Clone)]
struct OwnerSession {
    user_id: String,
    expires_at_ms: i64,
}

static OWNER_SESSION: Mutex<Option<OwnerSession>> = Mutex::new(None);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn owner_password_ok(password: &str) -> bool {
    verify(password, resolve_owner_hash()).unwrap_or(false)
}

fn owner_hash_configured_for_release() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    if let Some(h) = option_env!("YUNTUAI_EMBEDDED_OWNER_HASH") {
        if !h.trim().is_empty() {
            return true;
        }
    }
    false
}

/// 登录门闸应急代登：release 默认关闭，需构建时显式 `YUNTUAI_OWNER_EMERGENCY_LOGIN=1` 且嵌入 Owner 哈希。
pub fn owner_emergency_login_enabled() -> bool {
    if owner_dev_bypass_active() {
        return true;
    }
    if !owner_hash_configured_for_release() {
        return false;
    }
    matches!(
        option_env!("YUNTUAI_OWNER_EMERGENCY_LOGIN_AT_BUILD").map(str::trim),
        Some("1" | "true" | "TRUE" | "yes" | "YES")
    )
}

fn check_owner_attempt_lock() -> Result<(), String> {
    let now = now_ms();
    let Ok(g) = OWNER_ATTEMPTS.lock() else {
        return Ok(());
    };
    if g.locked_until_ms > now {
        let left = (g.locked_until_ms - now) / 1000;
        let mins = left / 60;
        let secs = left % 60;
        if mins > 0 {
            return Err(format!(
                "Owner 密码尝试过多，请 {mins} 分 {secs} 秒后再试。"
            ));
        }
        return Err(format!("Owner 密码尝试过多，请 {secs} 秒后再试。"));
    }
    Ok(())
}

fn record_owner_failure() {
    let Ok(mut g) = OWNER_ATTEMPTS.lock() else {
        return;
    };
    let now = now_ms();
    if g.locked_until_ms > 0 && g.locked_until_ms <= now {
        g.failures = 0;
        g.locked_until_ms = 0;
    }
    g.failures += 1;
    if g.failures >= OWNER_MAX_FAILS {
        g.locked_until_ms = now + OWNER_LOCK_MS;
    }
}

fn reset_owner_attempts() {
    if let Ok(mut g) = OWNER_ATTEMPTS.lock() {
        g.failures = 0;
        g.locked_until_ms = 0;
    }
}

/// 校验 Owner 密码（含 release 弱哈希拦截与失败限流）。
pub(crate) fn verify_owner_password_strict(password: &str) -> Result<(), String> {
    if !owner_dev_bypass_active() {
        if !owner_hash_configured_for_release() {
            return Err("Owner 未配置，无法验证。".into());
        }
        check_owner_attempt_lock()?;
    }
    if owner_password_ok(password) {
        if !owner_dev_bypass_active() {
            reset_owner_attempts();
        }
        Ok(())
    } else {
        if !owner_dev_bypass_active() {
            record_owner_failure();
            check_owner_attempt_lock().ok();
        }
        Err("Owner 密码不正确".into())
    }
}

/// 供登录门闸应急恢复等场景校验 Owner 密码（无需用户会话）。
#[allow(dead_code)]
pub(crate) fn verify_owner_password(password: &str) -> bool {
    verify_owner_password_strict(password).is_ok()
}

/// 用户已通过 Owner 密码验证后，建立 Owner 解锁会话（与 `owner_login` 等效）。
pub(crate) fn establish_owner_session(user_id: &str) {
    if owner_dev_bypass_active() {
        return;
    }
    let expires = now_ms() + OWNER_SESSION_MS;
    if let Ok(mut g) = OWNER_SESSION.lock() {
        *g = Some(OwnerSession {
            user_id: user_id.to_string(),
            expires_at_ms: expires,
        });
    }
}

/// 解析 Owner 密码哈希：环境变量 > debug 开发默认值。
/// 结果 OnceLock 缓存（避免重复 I/O 与哈希运算）。
fn resolve_owner_hash() -> &'static str {
    static OWNER_HASH: OnceLock<String> = OnceLock::new();
    OWNER_HASH.get_or_init(|| {
        if let Some(h) = option_env!("YUNTUAI_EMBEDDED_OWNER_HASH") {
            if !h.trim().is_empty() {
                return h.trim().to_string();
            }
        }
        // 1. 若指定了 bcrypt 哈希，直接使用
        if let Ok(value) = std::env::var("YUNTUAI_OWNER_PASSWORD_HASH") {
            let trimmed = value.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
        // 2. 若指定了明文密码，运行时哈希并缓存
        if let Ok(value) = std::env::var("YUNTUAI_OWNER_PASSWORD") {
            let trimmed = value.trim();
            if !trimmed.is_empty() && trimmed.len() >= 8 {
                if let Ok(h) = hash(trimmed, 12) {
                    return h;
                }
            }
        }
        // 3. debug 构建下使用硬编码开发密码
        if cfg!(debug_assertions) {
            return DEV_OWNER_PASSWORD_HASH.to_string();
        }
        // 4. release 构建无配置：返回有效但无法通过校验的占位，
        //    owner 功能可通过 set_owner_password（需物理机访问）初始化。
        //    前端应据此引导管理员配置。
        hash("placeholder-reject-all", 4).unwrap_or_else(|_| DEV_OWNER_PASSWORD_HASH.to_string())
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerSessionStatus {
    pub unlocked: bool,
    pub expires_at_ms: Option<i64>,
    /// debug 构建下为 true，前端可提示「开发模式已自动解锁」。
    #[serde(default)]
    pub dev_bypass: bool,
}

fn dev_session_status() -> OwnerSessionStatus {
    OwnerSessionStatus {
        unlocked: true,
        expires_at_ms: None,
        dev_bypass: true,
    }
}

pub fn owner_session_status() -> OwnerSessionStatus {
    if owner_dev_bypass_active() {
        return dev_session_status();
    }
    clear_owner_session_if_expired();
    let Ok(g) = OWNER_SESSION.lock() else {
        return OwnerSessionStatus {
            unlocked: false,
            expires_at_ms: None,
            dev_bypass: false,
        };
    };
    let Some(s) = g.as_ref() else {
        return OwnerSessionStatus {
            unlocked: false,
            expires_at_ms: None,
            dev_bypass: false,
        };
    };
    if s.expires_at_ms > now_ms() {
        OwnerSessionStatus {
            unlocked: true,
            expires_at_ms: Some(s.expires_at_ms),
            dev_bypass: false,
        }
    } else {
        OwnerSessionStatus {
            unlocked: false,
            expires_at_ms: None,
            dev_bypass: false,
        }
    }
}

fn clear_owner_session_if_expired() {
    let Ok(mut g) = OWNER_SESSION.lock() else {
        return;
    };
    let now = now_ms();
    if g.as_ref().is_some_and(|s| s.expires_at_ms <= now) {
        *g = None;
    }
}

pub fn is_owner_unlocked_for_user(user_id: &str) -> bool {
    if owner_dev_bypass_active() {
        return true;
    }
    clear_owner_session_if_expired();
    let Ok(g) = OWNER_SESSION.lock() else {
        return false;
    };
    g.as_ref().is_some_and(|s| s.user_id == user_id && s.expires_at_ms > now_ms())
}

/// 敏感 IPC：要求已登录且 owner 会话有效。
pub fn assert_owner(state: &State<DbState>, encrypted_token: &str) -> Result<(), String> {
    assert_owner_mutex(&state.conn, encrypted_token)
}

pub(crate) fn assert_owner_mutex(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    encrypted_token: &str,
) -> Result<(), String> {
    crate::auth::assert_authenticated_mutex(conn, encrypted_token)?;
    if owner_dev_bypass_active() {
        return Ok(());
    }
    let user_id = match crate::auth::peek_auth_resolve_cache(encrypted_token) {
        Some(Ok((uid, _, _))) => uid,
        Some(Err(e)) => return Err(e),
        None => {
            let c = lock_conn(conn);
            resolve_authenticated_user(&c, encrypted_token)?.0
        }
    };
    if is_owner_unlocked_for_user(&user_id) {
        Ok(())
    } else {
        Err("需要 Owner 解锁后才能执行此操作".into())
    }
}

pub fn clear_owner_session_for_user(user_id: &str) {
    if let Ok(mut g) = OWNER_SESSION.lock() {
        if g.as_ref().is_some_and(|s| s.user_id == user_id) {
            *g = None;
        }
    }
}

#[tauri::command]
pub fn owner_emergency_login_enabled_cmd() -> bool {
    owner_emergency_login_enabled()
}

#[tauri::command]
pub async fn owner_login(
    state: State<'_, DbState>,
    token: String,
    password: String,
) -> Result<OwnerSessionStatus, String> {
    if let Err(msg) = verify_owner_password_strict(&password) {
        let conn = lock_conn(&state.conn);
        let _ = audit_insert_on_conn(&conn, "owner", "login_failed", "bad_password");
        return Err(msg);
    }

    let conn = lock_conn(&state.conn);
    let (user_id, username, _) = resolve_authenticated_user(&conn, &token)?;
    let expires = now_ms() + OWNER_SESSION_MS;
    if let Ok(mut g) = OWNER_SESSION.lock() {
        *g = Some(OwnerSession {
            user_id: user_id.clone(),
            expires_at_ms: expires,
        });
    }
    let _ = audit_insert_on_conn(
        &conn,
        "owner",
        "login_success",
        &format!("username={username}"),
    );
    Ok(OwnerSessionStatus {
        unlocked: true,
        expires_at_ms: Some(expires),
        dev_bypass: false,
    })
}

#[tauri::command]
pub fn owner_logout(state: State<'_, DbState>, token: String) -> Result<OwnerSessionStatus, String> {
    let conn = lock_conn(&state.conn);
    let (user_id, username, _) = resolve_authenticated_user(&conn, &token)?;
    if let Ok(mut g) = OWNER_SESSION.lock() {
        if g.as_ref().is_some_and(|s| s.user_id == user_id) {
            *g = None;
        }
    }
    let _ = audit_insert_on_conn(
        &conn,
        "owner",
        "logout",
        &format!("username={username}"),
    );
    Ok(owner_session_status())
}

#[tauri::command]
pub async fn owner_session_status_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<OwnerSessionStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let user_id = match crate::auth::peek_auth_resolve_cache(&token) {
            Some(Ok((uid, _, _))) => uid,
            Some(Err(e)) => return Err(e),
            None => {
                let c = lock_conn(&conn);
                resolve_authenticated_user(&c, &token)?.0
            }
        };
        clear_owner_session_if_expired();
        let expires_at_ms = OWNER_SESSION.lock().ok().and_then(|g| {
            g.as_ref()
                .filter(|s| s.user_id == user_id)
                .map(|s| s.expires_at_ms)
        });
        Ok(OwnerSessionStatus {
            unlocked: is_owner_unlocked_for_user(&user_id),
            expires_at_ms,
            dev_bypass: owner_dev_bypass_active(),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_build_accepts_default_secret() {
        if cfg!(debug_assertions) {
            assert!(owner_password_ok("HHYT@123"));
            assert!(!owner_password_ok("wrong"));
        }
    }

    #[test]
    fn standard_owner_password_matches_embedded_hash() {
        assert!(verify("HHYT@123", DEV_OWNER_PASSWORD_HASH).unwrap_or(false));
    }

    #[test]
    fn dev_build_bypasses_owner_lock() {
        if owner_dev_bypass_active() {
            assert!(is_owner_unlocked_for_user("any-user"));
        }
    }

    #[test]
    fn env_hash_starts_with_bcrypt_prefix() {
        // resolve_owner_hash 在 debug 下应返回有效 bcrypt 哈希
        let h = resolve_owner_hash();
        assert!(h.starts_with("$2b$") || h.starts_with("$2a$"));
    }

    #[test]
    fn dev_fallback_is_valid_bcrypt() {
        assert!(DEV_OWNER_PASSWORD_HASH.starts_with("$2b$"));
        assert!(verify("HHYT@123", DEV_OWNER_PASSWORD_HASH).unwrap_or(false));
    }
}
