use crate::db::{audit_insert_on_conn, lock_conn, migrate_orphan_sessions, new_id, now_iso, DbState};
use bcrypt::{hash, verify};
use rand::Rng;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type AuthSessionRow = (String, String, String, String, Option<String>, Option<String>);
use tauri::State;

const BCRYPT_COST: u32 = 12;
const MIN_USERNAME_LEN: usize = 2;
const MAX_USERNAME_LEN: usize = 64;
/// 直连版：至少 8 位且含字母+数字（中转站见 `uses_eight_digit_login_password`）。
const DIRECT_MIN_PASSWORD_LEN: usize = 8;
const RELAY_PASSWORD_LEN: usize = 8;

/// 连续失败 N 次后锁定账户
const MAX_FAILED_ATTEMPTS: i64 = 5;
/// 锁定持续时间（毫秒）：15 分钟
const LOCK_DURATION_MS: i64 = 15 * 60 * 1000;
/// Token 有效期（毫秒）：由发行档决定（中转站 7 天，直连 30 天）。
fn token_expiry_ms() -> i64 {
    crate::distribution_policy::token_expiry_ms()
}
/// 解密 + DB 校验结果缓存，减轻高频 invoke 开销。
const AUTH_RESOLVE_CACHE_TTL: Duration = Duration::from_secs(5);

struct AuthResolveCache {
    encrypted_token: String,
    result: Result<(String, String, String), String>,
    at: Instant,
}

static AUTH_RESOLVE_CACHE: Mutex<Option<AuthResolveCache>> = Mutex::new(None);

fn invalidate_auth_resolve_cache() {
    if let Ok(mut g) = AUTH_RESOLVE_CACHE.lock() {
        *g = None;
    }
}

/// 与 db.rs backfill 逻辑一致：NULL 或无法解析的 expires_at 视为已过期。
pub(crate) fn is_token_expired(expires_at: &Option<String>, now: i64) -> bool {
    match expires_at {
        None => true,
        Some(exp) if exp.trim().is_empty() => true,
        Some(exp) => exp.parse::<i64>().map(|ms| now > ms).unwrap_or(true),
    }
}

fn purge_expired_token(conn: &rusqlite::Connection, real_token: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM auth_tokens WHERE token = ?1",
        rusqlite::params![real_token],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserRow {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn validate_username(s: &str) -> Result<String, String> {
    let trimmed: String = s.trim().chars().take(MAX_USERNAME_LEN).collect();
    if trimmed.len() < MIN_USERNAME_LEN {
        return Err(format!("用户名至少需要 {} 个字符", MIN_USERNAME_LEN));
    }
    // 只允许字母、数字、下划线、中划线
    for ch in trimmed.chars() {
        if !ch.is_ascii_alphanumeric() && ch != '_' && ch != '-' {
            return Err("用户名仅允许英文字母、数字、下划线和短横线".into());
        }
    }
    Ok(trimmed)
}

fn validate_password(s: &str) -> Result<String, String> {
    if crate::distribution_policy::uses_eight_digit_login_password() {
        if s.len() != RELAY_PASSWORD_LEN {
            return Err(format!("密码须为 {RELAY_PASSWORD_LEN} 位数字"));
        }
        if !s.chars().all(|c| c.is_ascii_digit()) {
            return Err("密码须为 8 位数字".into());
        }
        return Ok(s.to_string());
    }
    if s.len() < DIRECT_MIN_PASSWORD_LEN {
        return Err(format!("密码至少需要 {DIRECT_MIN_PASSWORD_LEN} 个字符"));
    }
    if s.len() > 128 {
        return Err("密码不能超过 128 个字符".into());
    }
    let has_letter = s.chars().any(|c| c.is_ascii_alphabetic());
    let has_digit = s.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_digit {
        return Err("密码必须同时包含英文字母和数字".into());
    }
    Ok(s.to_string())
}

/// 使用机器指纹 AES-256-GCM 加密 token，用于安全存储在前端 localStorage。
/// v2 前缀区分旧版 XOR 格式；解密时自动兼容旧 token。
const TOKEN_STORAGE_V2_PREFIX: &str = "v2:";

fn derive_storage_key(fingerprint_hex: &str) -> Result<[u8; 32], String> {
    use sha2::{Digest, Sha256};
    let fp = hex::decode(fingerprint_hex).map_err(|e| format!("指纹解码失败: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(b"yuntuai-auth-token-v2:");
    hasher.update(&fp);
    Ok(hasher.finalize().into())
}

fn encrypt_token_for_storage(token: &str, fingerprint_hex: &str) -> Result<String, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    let key_bytes = derive_storage_key(fingerprint_hex)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("密钥初始化失败: {e}"))?;
    let tk = hex::decode(token).map_err(|e| format!("token 解码失败: {e}"))?;
    if tk.len() != 32 {
        return Err("加密参数长度异常".into());
    }
    let mut nonce_bytes = [0u8; 12];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, tk.as_ref())
        .map_err(|e| format!("token 加密失败: {e}"))?;
    let mut packed = Vec::with_capacity(12 + ciphertext.len());
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);
    Ok(format!("{TOKEN_STORAGE_V2_PREFIX}{}", hex::encode(packed)))
}

fn decrypt_token_legacy_xor(encrypted_hex: &str, fingerprint_hex: &str) -> Result<String, String> {
    let fp = hex::decode(fingerprint_hex).map_err(|e| format!("指纹解码失败: {e}"))?;
    let enc = hex::decode(encrypted_hex).map_err(|e| format!("加密 token 解码失败: {e}"))?;
    if fp.len() != 32 || enc.len() != 32 {
        return Err("解密参数长度异常".into());
    }
    let mut out = Vec::with_capacity(32);
    for i in 0..32 {
        out.push(enc[i] ^ fp[i]);
    }
    Ok(hex::encode(out))
}

fn decrypt_token_v2(packed_hex: &str, fingerprint_hex: &str) -> Result<String, String> {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    let packed = hex::decode(packed_hex).map_err(|e| format!("加密 token 解码失败: {e}"))?;
    if packed.len() < 13 {
        return Err("解密参数长度异常".into());
    }
    let key_bytes = derive_storage_key(fingerprint_hex)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("密钥初始化失败: {e}"))?;
    let (nonce_bytes, ciphertext) = packed.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "会话无效，请重新登录".to_string())?;
    if plaintext.len() != 32 {
        return Err("解密参数长度异常".into());
    }
    Ok(hex::encode(plaintext))
}

pub(crate) fn peek_auth_resolve_cache(
    encrypted_token: &str,
) -> Option<Result<(String, String, String), String>> {
    let guard = AUTH_RESOLVE_CACHE.lock().ok()?;
    let cached = guard.as_ref()?;
    if cached.encrypted_token == encrypted_token && cached.at.elapsed() < AUTH_RESOLVE_CACHE_TTL {
        return Some(cached.result.clone());
    }
    None
}

pub(crate) fn assert_authenticated(state: &State<DbState>, token: &str) -> Result<(), String> {
    assert_authenticated_mutex(&state.conn, token)
}

pub(crate) fn assert_authenticated_mutex(
    conn: &Arc<Mutex<rusqlite::Connection>>,
    token: &str,
) -> Result<(), String> {
    // 缓存命中时不要抢全局 DB 锁：启动备份 / VACUUM 会长时间持锁，同步 IPC 会把窗口打成「未响应」。
    if let Some(cached) = peek_auth_resolve_cache(token) {
        return cached.map(|_| ());
    }
    let conn = lock_conn(conn);
    resolve_authenticated_user(&conn, token).map(|_| ())
}

/// 从前端 encrypted token 解析已认证用户；校验 token 有效且未过期。
pub(crate) fn resolve_authenticated_user(
    conn: &rusqlite::Connection,
    encrypted_token: &str,
) -> Result<(String, String, String), String> {
    if let Some(cached) = peek_auth_resolve_cache(encrypted_token) {
        return cached;
    }
    crate::license::assert_licensed()?;

    let real_token = decrypt_persisted_token(encrypted_token)?;

    let row: Result<(String, String, String, Option<String>), _> = conn.query_row(
        "SELECT u.id, u.username, u.role, t.expires_at FROM auth_tokens t JOIN users u ON t.user_id = u.id WHERE t.token = ?1",
        rusqlite::params![real_token],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        },
    );

    let result = match row {
        Ok((id, username, role, expires_at)) => {
            if is_token_expired(&expires_at, now_ms()) {
                let _ = purge_expired_token(conn, &real_token);
                return Err("会话已过期，请重新登录".into());
            }
            Ok((id, username, role))
        }
        Err(_) => Err("会话无效，请重新登录".into()),
    };

    if result.is_ok() {
        if let Ok(mut guard) = AUTH_RESOLVE_CACHE.lock() {
            *guard = Some(AuthResolveCache {
                encrypted_token: encrypted_token.to_string(),
                result: result.clone(),
                at: Instant::now(),
            });
        }
    }

    result
}

/// 解密从前端 localStorage 取回的加密 token（v2 AES-GCM 或旧版 XOR）。
fn decrypt_token_from_storage(encrypted: &str, fingerprint_hex: &str) -> Result<String, String> {
    if let Some(rest) = encrypted.strip_prefix(TOKEN_STORAGE_V2_PREFIX) {
        return decrypt_token_v2(rest, fingerprint_hex);
    }
    decrypt_token_legacy_xor(encrypted, fingerprint_hex)
}

/// 会话加密密钥落在数据目录，不跟主机名、逻辑核数走。
/// 许可证指纹仍用 `machine_fingerprint`，这里不能混用。
fn open_session_storage_key() -> Result<String, String> {
    let path = crate::paths::data_dir()?.join("session-bind.key");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let key = raw.trim().to_string();
        if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(key);
        }
    }
    let bytes: [u8; 32] = rand::thread_rng().gen();
    let key = hex::encode(bytes);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, &key).map_err(|e| format!("无法写入会话密钥: {e}"))?;
    Ok(key)
}

fn encrypt_persisted_token(token: &str) -> Result<String, String> {
    let key = open_session_storage_key()?;
    encrypt_token_for_storage(token, &key).map_err(|e| format!("无法生成会话令牌: {e}"))
}

fn decrypt_persisted_token(encrypted: &str) -> Result<String, String> {
    let key = open_session_storage_key()?;
    if let Ok(token) = decrypt_token_from_storage(encrypted, &key) {
        return Ok(token);
    }
    let fp = crate::license::machine_fingerprint()?;
    decrypt_token_from_storage(encrypted, &fp).map_err(|_| "会话无效，请重新登录".to_string())
}

/// 检查用户是否被锁定，返回 Ok(()) 或 Err(剩余秒数描述)
fn check_lockout_remaining(
    conn: &rusqlite::Connection,
    username: &str,
) -> Result<(), String> {
    let r: Result<(Option<i64>, i64), _> = conn.query_row(
        "SELECT lock_until, failed_attempts FROM users WHERE username = ?1",
        rusqlite::params![username],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    let (lock_until_opt, _failed) = match r {
        Ok(v) => v,
        Err(_) => return Ok(()), // 用户不存在，不泄露信息
    };

    let lock_until = match lock_until_opt {
        Some(v) => v,
        None => return Ok(()),
    };

    let now = now_ms();
    if lock_until > now {
        let remaining_secs = (lock_until - now) / 1000;
        let mins = remaining_secs / 60;
        let secs = remaining_secs % 60;
        if mins > 0 {
            return Err(format!(
                "由于多次登录失败，该账户已被临时锁定。请在 {} 分 {} 秒后重试。",
                mins, secs
            ));
        }
        return Err(format!(
            "由于多次登录失败，该账户已被临时锁定。请在 {} 秒后重试。",
            secs
        ));
    }

    // lock 已过期，清除
    let _ = conn.execute(
        "UPDATE users SET lock_until = NULL, failed_attempts = 0 WHERE username = ?1",
        rusqlite::params![username],
    );
    Ok(())
}

/// 记录登录尝试（成功或失败），用于审计
fn record_login_attempt(
    conn: &rusqlite::Connection,
    username: &str,
    success: bool,
) -> Result<(), String> {
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO login_attempts (id, username, success, ip_hint, created_at) VALUES (?1, ?2, ?3, NULL, ?4)",
        rusqlite::params![id, username, success as i32, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 失败后：递增 failed_attempts，达到阈值时设置 lock_until
fn record_failed_attempt(
    conn: &rusqlite::Connection,
    username: &str,
) -> Result<(), String> {
    let current: (i64, Option<i64>) = conn
        .query_row(
            "SELECT failed_attempts, lock_until FROM users WHERE username = ?1",
            rusqlite::params![username],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let new_count = current.0 + 1;
    if new_count >= MAX_FAILED_ATTEMPTS {
        let lock_until = now_ms() + LOCK_DURATION_MS;
        conn.execute(
            "UPDATE users SET failed_attempts = ?1, lock_until = ?2 WHERE username = ?3",
            rusqlite::params![new_count, lock_until, username],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE users SET failed_attempts = ?1 WHERE username = ?2",
            rusqlite::params![new_count, username],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 成功登录后：清除失败计数和锁定
fn clear_failed_attempts(
    conn: &rusqlite::Connection,
    username: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE users SET failed_attempts = 0, lock_until = NULL WHERE username = ?1",
        rusqlite::params![username],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 为已验证用户签发持久化会话（登录 / Owner 应急代登共用）。
fn issue_auth_session(
    conn: &rusqlite::Connection,
    id: &str,
    uname: &str,
    role: &str,
) -> Result<serde_json::Value, String> {
    let _ = migrate_orphan_sessions(conn);

    let _ = conn.execute(
        "DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER) < ?1",
        rusqlite::params![now_ms()],
    );

    let token = generate_token();
    let token_id = new_id();
    let now_str = now_iso();
    let expires_at = (now_ms() + token_expiry_ms()).to_string();
    conn.execute(
        "INSERT INTO auth_tokens (id, user_id, token, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![token_id, id, token, now_str, expires_at],
    )
    .map_err(|e| e.to_string())?;

    let created_at: String = conn
        .query_row(
            "SELECT created_at FROM users WHERE id = ?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    let encrypted_token = encrypt_persisted_token(&token)?;

    invalidate_auth_resolve_cache();

    Ok(serde_json::json!({
        "id": id,
        "username": uname,
        "role": role,
        "createdAt": created_at,
        "token": encrypted_token,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthGateStatus {
    /// 当前 users 表是否有账户
    pub has_users: bool,
    /// 本机是否已写入安装封印（防删库重注册）
    pub install_sealed: bool,
    /// 是否允许自助注册
    pub registration_allowed: bool,
    /// 封印仍在但用户表为空（疑似篡改）
    pub account_data_lost: bool,
    /// Owner 代登提示：本机已有账号名（最多 8 个，不含密码）
    pub recovery_usernames: Vec<String>,
}

fn count_users(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

fn list_usernames(conn: &rusqlite::Connection, limit: usize) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT username FROM users ORDER BY created_at ASC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![limit as i64], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 登录门闸状态（前端用于决定登录/注册与异常提示）。
#[tauri::command]
pub fn auth_gate_status(state: State<'_, DbState>) -> Result<AuthGateStatus, String> {
    let conn = lock_conn(&state.conn);
    let user_count = count_users(&conn)?;
    let has_users = user_count > 0;
    let install_sealed = crate::install_seal::is_install_sealed();
    let registration_allowed = crate::install_seal::registration_allowed(user_count);
    let recovery_usernames = if has_users {
        list_usernames(&conn, 8)?
    } else {
        Vec::new()
    };
    Ok(AuthGateStatus {
        has_users,
        install_sealed,
        registration_allowed,
        account_data_lost: install_sealed && !has_users,
        recovery_usernames,
    })
}
/// 注册新用户。仅首装未封印时允许自助注册；返回与 auth_login 一致的 JSON。
#[tauri::command]
pub async fn auth_register(
    state: State<'_, DbState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    crate::license::assert_licensed()?;
    let username = validate_username(&username)?;
    let password = validate_password(&password)?;
    let hash = hash(&password, BCRYPT_COST).map_err(|e| format!("密码加密失败: {e}"))?;

    let conn = lock_conn(&state.conn);

    let user_count = count_users(&conn)?;
    if !crate::install_seal::registration_allowed(user_count) {
        return Err(crate::install_seal::registration_denied_message(user_count).into());
    }

    // 检查用户名是否已存在
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM users WHERE username = ?1",
            rusqlite::params![username],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Err("该用户名已被注册".into());
    }

    let id = new_id();
    let now = now_iso();
    let role = if user_count == 0 { "admin" } else { "user" };

    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, lock_until, failed_attempts, created_at) VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5)",
        rusqlite::params![id, username, hash, role, now],
    )
    .map_err(|e| e.to_string())?;

    // 生成持久化 token（注册后自动登录）
    let token = generate_token();
    let token_id = new_id();
    let expires_at = (now_ms() + token_expiry_ms()).to_string();
    conn.execute(
        "INSERT INTO auth_tokens (id, user_id, token, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![token_id, id, token, now, expires_at],
    )
    .map_err(|e| e.to_string())?;

    let _ = migrate_orphan_sessions(&conn);

    // 审计: 注册（已持有 conn 锁，使用 on_conn 版本避免死锁）
    let _ = audit_insert_on_conn(
        &conn,
        "auth",
        "register",
        &format!("username={}, role={}", username, role),
    );

    let _ = crate::install_seal::write_install_seal();
    let encrypted_token = encrypt_persisted_token(&token)?;
    drop(conn);
    crate::db::spawn_durable_account_backup(state.conn.clone());

    Ok(serde_json::json!({
        "id": id,
        "username": username,
        "role": role,
        "createdAt": now,
        "token": encrypted_token,
    }))
}

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 32] = rng.gen();
    hex::encode(bytes)
}

/// 登录验证。成功返回用户信息 + 持久化 token。
#[tauri::command]
pub async fn auth_login(
    state: State<'_, DbState>,
    username: String,
    password: String,
) -> Result<serde_json::Value, String> {
    crate::license::assert_licensed()?;
    let username = validate_username(&username)?;

    enum Lookup {
        Hit {
            id: String,
            uname: String,
            stored_hash: String,
            role: String,
        },
        Miss,
    }

    let lookup = {
        let conn = lock_conn(&state.conn);
        check_lockout_remaining(&conn, &username)?;

        let row: Result<(String, String, String, String), _> = conn.query_row(
            "SELECT id, username, password_hash, role FROM users WHERE username = ?1",
            rusqlite::params![username],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        );

        match row {
            Ok((id, uname, stored_hash, role)) => Lookup::Hit {
                id,
                uname,
                stored_hash,
                role,
            },
            Err(_) => {
                if count_users(&conn)? == 0 {
                    return Err("系统中尚无账户，请先注册（首个用户将成为管理员）".into());
                }
                Lookup::Miss
            }
        }
    };

    match lookup {
        Lookup::Miss => Err("用户名或密码不正确".into()),
        Lookup::Hit {
            id,
            uname,
            stored_hash,
            role,
        } => {
            let valid = verify(&password, &stored_hash)
                .map_err(|e| format!("密码验证失败: {e}"))?;

            if !valid {
                let conn = lock_conn(&state.conn);
                let _ = record_failed_attempt(&conn, &username);
                let _ = record_login_attempt(&conn, &username, false);

                let _ = audit_insert_on_conn(
                    &conn,
                    "auth",
                    "login_failed",
                    &format!("username={}", username),
                );

                if let Err(lock_msg) = check_lockout_remaining(&conn, &username) {
                    return Err(format!("密码不正确。{}", lock_msg));
                }
                return Err("密码不正确".into());
            }

            let conn = lock_conn(&state.conn);
            let _ = clear_failed_attempts(&conn, &username);
            let _ = record_login_attempt(&conn, &username, true);

            let _ = audit_insert_on_conn(
                &conn,
                "auth",
                "login_success",
                &format!("username={}", username),
            );

            issue_auth_session(&conn, &id, &uname, &role)
        }
    }
}

/// 登录门闸：用户忘记密码时，Owner 验证通过后可代为登录目标账户（无需用户密码）。
/// 同时建立 Owner 解锁会话，便于重置密码等运维操作。
#[tauri::command]
pub async fn auth_owner_emergency_login(
    state: State<'_, DbState>,
    username: String,
    owner_password: String,
) -> Result<serde_json::Value, String> {
    crate::license::assert_licensed()?;
    if !crate::owner::owner_emergency_login_enabled() {
        return Err("未启用 Owner 应急登录。".into());
    }
    let username = validate_username(&username)?;
    if let Err(msg) = crate::owner::verify_owner_password_strict(&owner_password) {
        let conn = lock_conn(&state.conn);
        let _ = record_login_attempt(&conn, &username, false);
        let _ = audit_insert_on_conn(
            &conn,
            "owner",
            "emergency_login_failed",
            &format!("username={username}"),
        );
        return Err(msg);
    }
    let conn = lock_conn(&state.conn);

    let user_count = count_users(&conn)?;
    let cutoff_ms = (chrono::Utc::now() - chrono::Duration::hours(1)).timestamp_millis();
    let recent_emergency: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action IN ('owner_emergency_login', 'owner_bootstrap_user') AND CAST(created_at AS INTEGER) > ?1",
            rusqlite::params![cutoff_ms],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if recent_emergency >= 5 {
        return Err("Owner 应急登录过于频繁，请 1 小时后再试。".into());
    }

    let row: Result<(String, String, String), _> = conn.query_row(
        "SELECT id, username, role FROM users WHERE username = ?1",
        rusqlite::params![username],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );

    let (id, uname, role, bootstrapped, username_alias) = match row {
        Ok((id, uname, role)) => (id, uname, role, false, false),
        Err(_) if user_count == 0 => {
            let id = new_id();
            let now = now_iso();
            let bootstrap_secret = generate_token();
            let pw_hash =
                hash(&bootstrap_secret, BCRYPT_COST).map_err(|e| format!("密码加密失败: {e}"))?;
            conn.execute(
                "INSERT INTO users (id, username, password_hash, role, lock_until, failed_attempts, created_at) VALUES (?1, ?2, ?3, ?4, NULL, 0, ?5)",
                rusqlite::params![id, username, pw_hash, "admin", now],
            )
            .map_err(|e| e.to_string())?;
            let _ = audit_insert_on_conn(
                &conn,
                "owner",
                "owner_bootstrap_user",
                &format!("username={username}"),
            );
            let _ = crate::db::persist_durable_account_backup(&conn);
            (id, username.clone(), "admin".to_string(), true, false)
        }
        Err(_) if user_count == 1 => {
            let sole: (String, String, String) = conn
                .query_row(
                    "SELECT id, username, role FROM users LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(|e| e.to_string())?;
            let _ = audit_insert_on_conn(
                &conn,
                "owner",
                "emergency_login_username_alias",
                &format!("requested={username} actual={}", sole.1),
            );
            (sole.0, sole.1, sole.2, false, true)
        }
        Err(_) => {
            let known = list_usernames(&conn, 8)?;
            let _ = audit_insert_on_conn(
                &conn,
                "owner",
                "emergency_login_failed",
                &format!("username={username} user_missing"),
            );
            let hint = if known.is_empty() {
                "请填写首次注册时使用的用户名；若账户库已丢失且无法确认用户名，请联系管理员恢复 data/yuntuai.db。"
                    .to_string()
            } else {
                format!("本机已有账号：{}。请填写正确用户名。", known.join("、"))
            };
            return Err(format!("本机没有用户「{username}」。{hint}"));
        }
    };

    let _ = clear_failed_attempts(&conn, &uname);
    let _ = record_login_attempt(&conn, &uname, true);

    let _ = audit_insert_on_conn(
        &conn,
        "auth",
        if bootstrapped {
            "owner_bootstrap_user"
        } else if username_alias {
            "owner_emergency_login_alias"
        } else {
            "owner_emergency_login"
        },
        &format!(
            "username={}{}",
            uname,
            if username_alias {
                format!(" requested={username}")
            } else {
                String::new()
            }
        ),
    );

    let session = issue_auth_session(&conn, &id, &uname, &role)?;
    crate::owner::establish_owner_session(&id);
    Ok(session)
}

/// 使用持久化 token 恢复会话（应用重启后自动登录）。
/// 接收前端传来的加密 token，解密后再查询数据库。
#[tauri::command]
pub async fn auth_resume_session(
    state: State<'_, DbState>,
    token: String,
) -> Result<serde_json::Value, String> {
    crate::license::assert_licensed()?;
    let real_token = decrypt_persisted_token(&token).map_err(|_| "会话已过期，请重新登录".to_string())?;
    let conn = lock_conn(&state.conn);

    // 检查 token 是否过期
    let row: Result<AuthSessionRow, _> = conn.query_row(
        "SELECT u.id, u.username, u.role, u.created_at, t.last_used_at, t.expires_at FROM auth_tokens t JOIN users u ON t.user_id = u.id WHERE t.token = ?1",
        rusqlite::params![real_token],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        },
    );

    match row {
        Ok((id, username, role, created_at, _last_used, expires_at)) => {
            if is_token_expired(&expires_at, now_ms()) {
                let _ = purge_expired_token(&conn, &real_token);
                return Err("会话已过期，请重新登录".into());
            }

            // 更新最后使用时间
            let now_str = now_iso();
            let _ = conn.execute(
                "UPDATE auth_tokens SET last_used_at = ?1 WHERE token = ?2",
                rusqlite::params![now_str, real_token],
            );

            let encrypted_token = encrypt_persisted_token(&real_token)?;

            Ok(serde_json::json!({
                "id": id,
                "username": username,
                "role": role,
                "createdAt": created_at,
                "token": encrypted_token,
            }))
        }
        Err(_) => Err("会话已过期，请重新登录".into()),
    }
}

/// 退出登录：删除该 token，让同一设备下次启动需要重新登录。
/// 接收前端传来的加密 token。
#[tauri::command]
pub fn auth_logout(
    state: State<'_, DbState>,
    token: String,
) -> Result<(), String> {
    let conn = lock_conn(&state.conn);

    let real_token = decrypt_persisted_token(&token).map_err(|_| "会话无效".to_string())?;

    if let Ok((user_id, _, _)) = resolve_authenticated_user(&conn, &token) {
        crate::owner::clear_owner_session_for_user(&user_id);
    }

    conn.execute(
        "DELETE FROM auth_tokens WHERE token = ?1",
        rusqlite::params![real_token],
    )
    .map_err(|e| e.to_string())?;
    invalidate_auth_resolve_cache();
    Ok(())
}

/// 修改当前用户密码（需要旧密码验证）。
#[tauri::command]
pub async fn auth_change_password(
    state: State<'_, DbState>,
    token: String,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let new_password = validate_password(&new_password)?;

    let (user_id, username, real_token, stored_hash) = {
        let conn = lock_conn(&state.conn);
        let (user_id, username, _) = resolve_authenticated_user(&conn, &token)?;

        let real_token = decrypt_persisted_token(&token)?;

        let stored_hash: String = conn
            .query_row(
                "SELECT password_hash FROM users WHERE id = ?1",
                rusqlite::params![user_id],
                |r| r.get(0),
            )
            .map_err(|_| "会话无效，请重新登录".to_string())?;

        (user_id, username, real_token, stored_hash)
    };

    let valid = verify(&old_password, &stored_hash).map_err(|e| format!("密码验证失败: {e}"))?;
    if !valid {
        return Err("旧密码不正确".into());
    }

    if old_password == new_password {
        return Err("新密码不能与旧密码相同".into());
    }

    let new_hash = hash(&new_password, BCRYPT_COST).map_err(|e| format!("密码加密失败: {e}"))?;

    let conn = lock_conn(&state.conn);
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        rusqlite::params![new_hash, user_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM auth_tokens WHERE user_id = ?1 AND token != ?2",
        rusqlite::params![user_id, real_token],
    )
    .map_err(|e| e.to_string())?;
    invalidate_auth_resolve_cache();

    // 审计
    let _ = audit_insert_on_conn(&conn, "auth", "change_password", &format!("username={}", username));

    Ok(())
}

/// Owner 解锁后：重置任意用户密码（无需旧密码）。
#[tauri::command]
pub fn auth_admin_reset_password(
    state: State<'_, DbState>,
    token: String,
    target_user_id: String,
    new_password: String,
) -> Result<(), String> {
    crate::owner::assert_owner(&state, &token)?;
    let new_password = validate_password(&new_password)?;
    let target_name: String = {
        let conn = lock_conn(&state.conn);
        conn.query_row(
            "SELECT username FROM users WHERE id = ?1",
            rusqlite::params![target_user_id],
            |r| r.get(0),
        )
        .map_err(|_| "用户不存在".to_string())?
    };
    let new_hash = hash(&new_password, BCRYPT_COST).map_err(|e| format!("密码加密失败: {e}"))?;
    let conn = lock_conn(&state.conn);
    conn.execute(
        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
        rusqlite::params![new_hash, target_user_id],
    )
    .map_err(|e| e.to_string())?;
    let _ = audit_insert_on_conn(
        &conn,
        "auth",
        "admin_reset_password",
        &format!("target={target_name}"),
    );
    conn.execute(
        "DELETE FROM auth_tokens WHERE user_id = ?1",
        rusqlite::params![target_user_id],
    )
    .map_err(|e| e.to_string())?;
    invalidate_auth_resolve_cache();
    Ok(())
}

/// 删除用户（需 Owner 解锁）。
#[tauri::command]
pub fn auth_delete_user(
    state: State<'_, DbState>,
    token: String,
    target_user_id: String,
) -> Result<(), String> {
    crate::owner::assert_owner(&state, &token)?;
    let conn = lock_conn(&state.conn);

    let real_token = decrypt_persisted_token(&token).map_err(|_| "会话无效".to_string())?;

    let requester_id: String = conn
        .query_row(
            "SELECT u.id FROM auth_tokens t JOIN users u ON t.user_id = u.id WHERE t.token = ?1",
            rusqlite::params![real_token],
            |r| r.get(0),
        )
        .map_err(|_| "会话无效".to_string())?;

    let requester_name: String = conn
        .query_row(
            "SELECT username FROM users WHERE id = ?1",
            rusqlite::params![requester_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if requester_id == target_user_id {
        return Err("不能删除自己的账户".into());
    }

    let target_name: String = conn
        .query_row(
            "SELECT username FROM users WHERE id = ?1",
            rusqlite::params![target_user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM users WHERE id = ?1",
        rusqlite::params![target_user_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = audit_insert_on_conn(
        &conn,
        "auth",
        "delete_user",
        &format!("by={requester_name}, target={target_name}, target_id={target_user_id}"),
    );

    invalidate_auth_resolve_cache();
    Ok(())
}

/// 修改用户角色（需 Owner 解锁）。
#[tauri::command]
pub fn auth_set_user_role(
    state: State<'_, DbState>,
    token: String,
    target_user_id: String,
    new_role: String,
) -> Result<(), String> {
    if new_role != "admin" && new_role != "user" {
        return Err("角色仅支持 admin 或 user".into());
    }
    crate::owner::assert_owner(&state, &token)?;

    let conn = lock_conn(&state.conn);

    let real_token = decrypt_persisted_token(&token).map_err(|_| "会话无效".to_string())?;

    let requester_id: String = conn
        .query_row(
            "SELECT u.id FROM auth_tokens t JOIN users u ON t.user_id = u.id WHERE t.token = ?1",
            rusqlite::params![real_token],
            |r| r.get(0),
        )
        .map_err(|_| "会话无效".to_string())?;

    let requester_name: String = conn
        .query_row(
            "SELECT username FROM users WHERE id = ?1",
            rusqlite::params![requester_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    if requester_id == target_user_id {
        return Err("不能修改自己的角色".into());
    }

    let target_name: String = conn
        .query_row(
            "SELECT username FROM users WHERE id = ?1",
            rusqlite::params![target_user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE users SET role = ?1 WHERE id = ?2",
        rusqlite::params![new_role, target_user_id],
    )
    .map_err(|e| e.to_string())?;

    let _ = audit_insert_on_conn(
        &conn,
        "auth",
        "set_role",
        &format!("by={requester_name}, target={target_name}, new_role={new_role}"),
    );

    invalidate_auth_resolve_cache();
    Ok(())
}

/// 手动清理所有过期 token（需已登录）。
#[tauri::command]
pub fn auth_cleanup_expired_tokens(state: State<'_, DbState>, token: String) -> Result<i64, String> {
    let conn = lock_conn(&state.conn);
    let _ = resolve_authenticated_user(&conn, &token)?;
    let n = conn
        .execute(
            "DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER) < ?1",
            rusqlite::params![now_ms()],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as i64)
}

/// 返回当前所有用户（管理员专用）。
#[tauri::command]
pub fn auth_list_users(state: State<'_, DbState>, token: String) -> Result<Vec<UserRow>, String> {
    crate::owner::assert_owner(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let mut stmt = conn
        .prepare("SELECT id, username, role, created_at FROM users ORDER BY username ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(UserRow {
                id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 查询是否已有用户（含安装封印：防删库后误显示注册页）。
#[tauri::command]
pub fn auth_has_users(state: State<'_, DbState>) -> Result<bool, String> {
    let conn = lock_conn(&state.conn);
    let has_users = count_users(&conn)? > 0;
    Ok(has_users || crate::install_seal::is_install_sealed())
}

/// 开发构建：是否跳过登录门闸（`cargo tauri dev` / debug 构建为 true）。
#[tauri::command]
pub fn auth_dev_skip_login() -> bool {
    cfg!(debug_assertions)
}

const DEV_AUTO_USER: &str = "dev";

fn ensure_dev_user(conn: &rusqlite::Connection) -> Result<(String, String, String), String> {
    if let Ok(row) = conn.query_row(
        "SELECT id, username, role FROM users WHERE username = ?1",
        rusqlite::params![DEV_AUTO_USER],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    ) {
        return Ok(row);
    }
    let id = new_id();
    let now = now_iso();
    let pw_hash = hash("devlocal", BCRYPT_COST).map_err(|e| format!("密码加密失败: {e}"))?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, lock_until, failed_attempts, created_at) VALUES (?1, ?2, ?3, 'admin', NULL, 0, ?4)",
        rusqlite::params![id, DEV_AUTO_USER, pw_hash, now],
    )
    .map_err(|e| e.to_string())?;
    Ok((id, DEV_AUTO_USER.to_string(), "admin".to_string()))
}

/// 开发构建：自动创建/登录 `dev` 管理员，无需注册或密码。
#[tauri::command]
pub fn auth_dev_auto_login(state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    if !cfg!(debug_assertions) {
        return Err("仅开发构建可用".into());
    }
    #[cfg(not(debug_assertions))]
    crate::license::assert_licensed()?;
    let conn = lock_conn(&state.conn);
    let user_count = count_users(&conn)?;
    crate::install_seal::clear_install_seal_if_orphaned(user_count)?;
    let (id, uname, role) = ensure_dev_user(&conn)?;
    issue_auth_session(&conn, &id, &uname, &role)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_expiry_null_is_expired() {
        assert!(is_token_expired(&None, 1));
        assert!(is_token_expired(&Some(String::new()), 1));
    }

    #[test]
    fn token_expiry_future_is_valid() {
        assert!(!is_token_expired(&Some("9999999999999".into()), 1));
    }

    #[test]
    fn validate_password_rejects_short() {
        assert!(validate_password("ab1").is_err());
    }

    #[test]
    fn validate_password_direct_requires_letter_and_digit() {
        assert!(validate_password("abcdefgh").is_err());
        assert!(validate_password("12345678").is_err());
        assert!(validate_password("abc12345").is_ok());
    }

    #[test]
    fn registration_blocked_when_sealed_without_users() {
        assert!(!crate::install_seal::registration_allowed(0) || !crate::install_seal::is_install_sealed());
    }

    #[test]
    fn token_storage_v2_roundtrip() {
        let fp = "aa".repeat(32);
        let token = "bb".repeat(32);
        let enc = encrypt_token_for_storage(&token, &fp).expect("encrypt");
        assert!(enc.starts_with(TOKEN_STORAGE_V2_PREFIX));
        let dec = decrypt_token_from_storage(&enc, &fp).expect("decrypt v2");
        assert_eq!(dec, token);
    }

    #[test]
    fn token_storage_legacy_xor_still_decrypts() {
        let fp = "cc".repeat(32);
        let token = "dd".repeat(32);
        let enc = encrypt_token_legacy_xor_for_test(&token, &fp);
        let dec = decrypt_token_from_storage(&enc, &fp).expect("legacy decrypt");
        assert_eq!(dec, token);
    }

    fn encrypt_token_legacy_xor_for_test(token: &str, fingerprint_hex: &str) -> String {
        let fp = hex::decode(fingerprint_hex).unwrap();
        let tk = hex::decode(token).unwrap();
        let mut out = Vec::with_capacity(32);
        for i in 0..32 {
            out.push(tk[i] ^ fp[i]);
        }
        hex::encode(out)
    }
}
