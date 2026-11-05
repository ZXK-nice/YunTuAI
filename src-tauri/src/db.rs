use rusqlite::backup::Backup;
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::auth::resolve_authenticated_user;
use crate::openclaw_runtime::strip_bom;
use crate::paths;

/// 与前端单条大消息/附件上限对齐的量级，防止异常写入撑爆本机库
const MAX_MSG_BYTES: usize = 4 * 1024 * 1024;
const MAX_ROLE_CHARS: usize = 64;
const MAX_REMOTE_KEY_CHARS: usize = 1024;
/// 自动备份：与上次备份至少间隔 6h（启动 / 干净退出 各会尝试一次，避免短间隔重复写盘）
const MIN_BACKUP_INTERVAL_MS: u64 = 6 * 60 * 60 * 1000;
const BACKUP_NAME_PREFIX: &str = "yuntuai-backup-";
const BACKUP_NAME_SUFFIX: &str = ".db.bak";
const KEEP_BACKUP_FILES: usize = 5;
/// 审计日志保留天数（按 created_at 毫秒时间戳）
const AUDIT_RETENTION_DAYS: u64 = 90;
/// 审计日志最大行数（超出则保留最新）
const AUDIT_MAX_ROWS: i64 = 50_000;
/// 每用户保留的本地会话数（超出删除最久未更新）
const SESSION_MAX_ROWS: i64 = 250;
/// 单会话保留的本地消息数（超出删除最旧）
const MESSAGES_MAX_PER_SESSION: i64 = 3_000;
/// 每用户保留的任务记录数
const TASK_MAX_ROWS: i64 = 400;
/// 登录尝试记录保留天数
const LOGIN_ATTEMPTS_RETENTION_DAYS: u64 = 90;
const LOGIN_ATTEMPTS_MAX_ROWS: i64 = 10_000;
/// 裁剪删除行数达到该阈值时才执行 VACUUM（避免频繁整库整理）
const VACUUM_MIN_DELETED_ROWS: u64 = 50;

pub struct DbState {
    pub conn: Arc<Mutex<Connection>>,
}

/// 多线程 invoke 并发访问 DB 时避免 `lock().map_err` 在 Mutex 中毒后永久失败；取回内部连接继续服务。
pub(crate) fn lock_conn(m: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn open_conn() -> Result<Connection, String> {
    let db_path = paths::db_file_path()?;

    // 打开连接：若上次非正常退出（强杀/断电/崩溃）残留了 WAL，SQLite 会在此
    // 自动回放，从而保留最后一个已提交但未 checkpoint 的事务（不丢最近数据）。
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // 打开后给足忙等窗口，并主动执行一次 TRUNCATE checkpoint：
    // 将 WAL 内容合并回主库并把 WAL 截断为 0，避免其无限增长导致
    // 下次启动回放缓慢。checkpoint 失败（如非 WAL 模式）时安全忽略。
    let _ = conn.busy_timeout(Duration::from_secs(8));
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    Ok(conn)
}

pub(crate) fn migrate(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          lock_until INTEGER,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_attempts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          success INTEGER NOT NULL DEFAULT 0,
          ip_hint TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts_user ON login_attempts(username, created_at DESC);
        CREATE TABLE IF NOT EXISTS local_sessions (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          remote_session_key TEXT,
          agent_id TEXT,
          user_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS local_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON local_messages(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_local_sessions_user_updated ON local_sessions(user_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          category TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
        CREATE TABLE IF NOT EXISTS auth_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token TEXT NOT NULL UNIQUE,
          user_agent TEXT,
          ip_hint TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_auth_tokens_token ON auth_tokens(token);
        CREATE TABLE IF NOT EXISTS local_tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_id TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          template_id TEXT,
          capability_snapshot TEXT,
          outcome TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_tasks_user_updated
          ON local_tasks(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_local_tasks_session
          ON local_tasks(session_id, created_at DESC);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

const CURRENT_SCHEMA_VERSION: i32 = 1;

fn ensure_schema_version_table(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_version (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          version INTEGER NOT NULL
        );
        "#,
    )
    .map_err(|e| e.to_string())
}

fn read_schema_version(c: &Connection) -> Result<i32, String> {
    ensure_schema_version_table(c)?;
    let version: Option<i32> = c
        .query_row(
            "SELECT version FROM schema_version WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .ok();
    Ok(version.unwrap_or(0))
}

fn write_schema_version(c: &Connection, version: i32) -> Result<(), String> {
    c.execute(
        "INSERT INTO schema_version (id, version) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version",
        params![version],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn sqlite_table_exists(c: &Connection, name: &str) -> Result<bool, String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![name],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// 升级前已跑过旧版 `init_db` ensure 链、仅缺 `schema_version` 戳记的安装。
fn legacy_install_missing_schema_stamp(c: &Connection) -> Result<bool, String> {
    Ok(sqlite_table_exists(c, "gateway_events")? || sqlite_table_exists(c, "meeting_sessions")?)
}

pub(crate) fn migrate_schema_to_v1(c: &Connection) -> Result<(), String> {
    ensure_local_sessions_agent_id(c)?;
    ensure_local_sessions_user_id(c)?;
    ensure_users_lock_columns(c)?;
    ensure_users_role(c)?;
    migrate_orphan_sessions(c)?;
    ensure_local_tasks(c)?;
    ensure_local_messages_display_content(c)?;
    ensure_auth_tokens_expires_at(c)?;
    ensure_meeting_tables(c)?;
    crate::session_archive::ensure_local_sessions_archive_columns(c)?;
    ensure_gateway_events(c)?;
    backfill_auth_token_expires(c)?;
    Ok(())
}

pub(crate) fn apply_schema_migrations(c: &Connection) -> Result<(), String> {
    migrate(c)?;
    let mut version = read_schema_version(c)?;
    eprintln!("[YunTuAI DB] apply_schema_migrations: version={version}");
    if version < 1 {
        if legacy_install_missing_schema_stamp(c)? {
            eprintln!("[YunTuAI DB] apply_schema_migrations: legacy install fast-stamp v1");
        } else {
            eprintln!("[YunTuAI DB] apply_schema_migrations: migrating schema to v1");
            migrate_schema_to_v1(c)?;
        }
        write_schema_version(c, 1)?;
        version = 1;
        eprintln!("[YunTuAI DB] apply_schema_migrations: stamped schema_version=1");
    }
    if version < CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "数据库 schema 版本 {version} 低于应用要求 {CURRENT_SCHEMA_VERSION}，请升级客户端"
        ));
    }
    Ok(())
}

fn ensure_local_tasks(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS local_tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          session_id TEXT,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          template_id TEXT,
          capability_snapshot TEXT,
          outcome TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(session_id) REFERENCES local_sessions(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_local_tasks_user_updated
          ON local_tasks(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_local_tasks_session
          ON local_tasks(session_id, created_at DESC);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_local_sessions_agent_id(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('local_sessions') WHERE name = 'agent_id'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute("ALTER TABLE local_sessions ADD COLUMN agent_id TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_local_sessions_user_id(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('local_sessions') WHERE name = 'user_id'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute("ALTER TABLE local_sessions ADD COLUMN user_id TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将升级前无 user_id 的会话归属到首个管理员（或首个用户）。
pub(crate) fn migrate_orphan_sessions(c: &Connection) -> Result<(), String> {
    let orphans: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM local_sessions WHERE user_id IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if orphans == 0 {
        return Ok(());
    }
    let owner: Option<String> = c
        .query_row(
            "SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok()
        .or_else(|| {
            c.query_row(
                "SELECT id FROM users ORDER BY created_at ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok()
        });
    let Some(owner_id) = owner else {
        return Ok(());
    };
    c.execute(
        "UPDATE local_sessions SET user_id = ?1 WHERE user_id IS NULL",
        params![owner_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_users_lock_columns(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'lock_until'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute("ALTER TABLE users ADD COLUMN lock_until INTEGER", [])
            .map_err(|e| e.to_string())?;
    }
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'failed_attempts'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute(
            "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_users_role(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'role'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute(
            "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn ensure_local_messages_display_content(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('local_messages') WHERE name = 'display_content'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute(
            "ALTER TABLE local_messages ADD COLUMN display_content TEXT",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_gateway_events(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS gateway_events (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          session_key TEXT,
          message_id TEXT,
          send_id TEXT,
          event_name TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gateway_events_session
          ON gateway_events(session_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_gateway_events_send
          ON gateway_events(send_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_gateway_events_message
          ON gateway_events(message_id, created_at DESC);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn gateway_event_insert_batch_on_conn(
    conn: &Connection,
    rows: &[crate::gateway_lifecycle::GatewayEventInsertRow],
) -> Result<u64, String> {
    let mut n: u64 = 0;
    for row in rows.iter().take(200) {
        conn.execute(
            "INSERT OR IGNORE INTO gateway_events
             (id, session_id, session_key, message_id, send_id, event_name, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                row.id,
                row.session_id,
                row.session_key,
                row.message_id,
                row.send_id,
                row.event_name,
                row.payload_json,
                row.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayEventRow {
    pub id: String,
    pub session_id: Option<String>,
    pub session_key: Option<String>,
    pub message_id: Option<String>,
    pub send_id: Option<String>,
    pub event_name: String,
    pub payload_json: String,
    pub created_at: String,
}

pub(crate) fn gateway_events_list_on_conn(
    conn: &rusqlite::Connection,
    session_id: Option<&str>,
    send_id: Option<&str>,
    limit: i64,
) -> Result<Vec<GatewayEventRow>, String> {
    let lim = limit.clamp(1, 500);
    let mut rows: Vec<GatewayEventRow> = Vec::new();
    if let Some(sid) = session_id.filter(|s| !s.trim().is_empty()) {
        if let Some(send) = send_id.filter(|s| !s.trim().is_empty()) {
            let mut stmt = conn
                .prepare(
                    "SELECT id, session_id, session_key, message_id, send_id, event_name, payload_json, created_at
                     FROM gateway_events WHERE session_id = ?1 AND send_id = ?2
                     ORDER BY created_at ASC LIMIT ?3",
                )
                .map_err(|e| e.to_string())?;
            let mapped = stmt
                .query_map(params![sid, send, lim], map_gateway_event_row)
                .map_err(|e| e.to_string())?;
            for r in mapped {
                rows.push(r.map_err(|e| e.to_string())?);
            }
            return Ok(rows);
        }
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, session_key, message_id, send_id, event_name, payload_json, created_at
                 FROM gateway_events WHERE session_id = ?1
                 ORDER BY created_at DESC LIMIT ?2",
            )
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map(params![sid, lim], map_gateway_event_row)
            .map_err(|e| e.to_string())?;
        for r in mapped {
            rows.push(r.map_err(|e| e.to_string())?);
        }
        rows.reverse();
        return Ok(rows);
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, session_key, message_id, send_id, event_name, payload_json, created_at
             FROM gateway_events ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map(params![lim], map_gateway_event_row)
        .map_err(|e| e.to_string())?;
    for r in mapped {
        rows.push(r.map_err(|e| e.to_string())?);
    }
    rows.reverse();
    Ok(rows)
}

fn map_gateway_event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<GatewayEventRow> {
    Ok(GatewayEventRow {
        id: row.get(0)?,
        session_id: row.get(1)?,
        session_key: row.get(2)?,
        message_id: row.get(3)?,
        send_id: row.get(4)?,
        event_name: row.get(5)?,
        payload_json: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn ensure_meeting_tables(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS meeting_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          audio_path TEXT,
          started_at_ms INTEGER NOT NULL,
          ended_at_ms INTEGER,
          last_digest_end_ms INTEGER NOT NULL DEFAULT 0,
          digest_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_sessions_user_updated
          ON meeting_sessions(user_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS meeting_segments (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          text TEXT NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_segments_session
          ON meeting_segments(session_id, start_ms);
        CREATE TABLE IF NOT EXISTS meeting_digests (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          period_index INTEGER NOT NULL,
          start_ms INTEGER NOT NULL,
          end_ms INTEGER NOT NULL,
          summary TEXT NOT NULL,
          action_items_json TEXT,
          decisions_json TEXT,
          open_questions_json TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES meeting_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_meeting_digests_session
          ON meeting_digests(session_id, period_index);
        "#,
    )
    .map_err(|e| e.to_string())?;
    let has_wall: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('meeting_sessions') WHERE name = 'last_digest_wall_ms'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_wall == 0 {
        c.execute(
            "ALTER TABLE meeting_sessions ADD COLUMN last_digest_wall_ms INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    let has_aliases: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('meeting_sessions') WHERE name = 'speaker_aliases_json'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if has_aliases == 0 {
        c.execute(
            "ALTER TABLE meeting_sessions ADD COLUMN speaker_aliases_json TEXT NOT NULL DEFAULT '{}'",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn ensure_auth_tokens_expires_at(c: &Connection) -> Result<(), String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('auth_tokens') WHERE name = 'expires_at'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        c.execute(
            "ALTER TABLE auth_tokens ADD COLUMN expires_at TEXT",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 与 auth.rs `token_expiry_ms()` 对齐：为升级前无 expires_at 的 token 补全过期时间。
fn backfill_auth_token_expires(c: &Connection) -> Result<(), String> {
    let token_expiry_ms = crate::distribution_policy::token_expiry_ms();
    let now = now_ms() as i64;
    c.execute(
        "UPDATE auth_tokens SET expires_at = CAST((CAST(created_at AS INTEGER) + ?1) AS TEXT)
         WHERE (expires_at IS NULL OR expires_at = '') AND created_at GLOB '[0-9]*'",
        params![token_expiry_ms],
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE auth_tokens SET expires_at = CAST((?1 + ?2) AS TEXT)
         WHERE expires_at IS NULL OR expires_at = ''",
        params![now, token_expiry_ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn truncate_audit_detail(detail: &str, max_chars: usize) -> String {
    let count = detail.chars().count();
    if count <= max_chars {
        return detail.to_string();
    }
    let head: String = detail.chars().take(max_chars).collect();
    format!("{head}…(truncated)")
}

fn require_session_owned(conn: &Connection, session_id: &str, user_id: &str) -> Result<(), String> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT user_id FROM local_sessions WHERE id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                "未找到该会话或已删除".into()
            } else {
                e.to_string()
            }
        })?;
    match owner {
        None => Err("会话数据异常".into()),
        Some(ref oid) if oid == user_id => Ok(()),
        Some(_) => Err("无权访问此会话".into()),
    }
}

fn resolve_authenticated_user_id(conn: &Connection, token: &str) -> Result<String, String> {
    let (user_id, _, _) = resolve_authenticated_user(conn, token)?;
    Ok(user_id)
}

fn norm_session_id(session_id: &str) -> Result<String, String> {
    let s = session_id.trim();
    if s.is_empty() {
        return Err("session_id 无效".into());
    }
    if s.len() > 128 {
        return Err("session_id 过长".into());
    }
    Ok(s.to_string())
}

fn normalize_new_session_title(title: String) -> String {
    let t: String = title.trim().chars().take(200).collect();
    if t.is_empty() {
        "新会话".into()
    } else {
        t
    }
}

fn db_sidecar_paths(db_path: &Path) -> [PathBuf; 2] {
    let base = db_path.as_os_str().to_string_lossy();
    [
        PathBuf::from(format!("{base}-wal")),
        PathBuf::from(format!("{base}-shm")),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct DbUserDataCounts {
    users: i64,
    sessions: i64,
    messages: i64,
}

/// 比较候选库「用户数据丰富度」：会话与消息权重高于「仅有空用户行」。
fn db_user_data_score_from_counts(counts: DbUserDataCounts) -> i64 {
    counts
        .users
        .saturating_mul(1_000_000_000)
        .saturating_add(counts.sessions.saturating_mul(1_000_000))
        .saturating_add(counts.messages)
}

fn db_user_data_counts(db_path: &Path) -> Result<DbUserDataCounts, String> {
    if !db_path.is_file() {
        return Ok(DbUserDataCounts::default());
    }
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    let users: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    let sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM local_sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let messages: i64 = conn
        .query_row("SELECT COUNT(*) FROM local_messages", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(DbUserDataCounts {
        users,
        sessions,
        messages,
    })
}

fn db_user_data_score(db_path: &Path) -> Result<i64, String> {
    Ok(db_user_data_score_from_counts(db_user_data_counts(db_path)?))
}

fn same_db_path(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn push_database_candidate(
    path: PathBuf,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<PathBuf>,
) {
    if !path.is_file() {
        return;
    }
    let key = fs::canonicalize(&path).unwrap_or(path.clone());
    if !seen.insert(key) {
        return;
    }
    out.push(path);
}

fn append_data_dir_backup_candidates(
    dir: &Path,
    seen: &mut HashSet<PathBuf>,
    out: &mut Vec<PathBuf>,
) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        let is_backup = (name.starts_with(BACKUP_NAME_PREFIX) && name.ends_with(BACKUP_NAME_SUFFIX))
            || name.ends_with(".db.pre-reconcile.bak")
            || name.ends_with(".db.corrupt.bak");
        if is_backup {
            push_database_candidate(path, seen, out);
        }
    }
}

/// 主库、兄弟安装目录、以及各 data 目录下的自动/损坏备份库。
fn collect_reconcile_database_candidates(primary: &Path) -> Result<Vec<PathBuf>, String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    push_database_candidate(primary.to_path_buf(), &mut seen, &mut out);
    if let Some(parent) = primary.parent() {
        append_data_dir_backup_candidates(parent, &mut seen, &mut out);
    }
    for root in paths::candidate_install_roots()? {
        let data_dir = root.join("data");
        push_database_candidate(data_dir.join("yuntuai.db"), &mut seen, &mut out);
        append_data_dir_backup_candidates(&data_dir, &mut seen, &mut out);
    }
    Ok(out)
}

fn pick_best_database_candidate(candidates: &[PathBuf]) -> Option<(i64, PathBuf)> {
    let mut best: Option<(i64, PathBuf)> = None;
    for path in candidates {
        let score = db_user_data_score(path).unwrap_or(0);
        if score <= 0 {
            continue;
        }
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, path.clone()));
        }
    }
    best
}

fn copy_db_tree(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if dest.is_file() {
        let bak = dest.with_extension("db.pre-reconcile.bak");
        let _ = std::fs::rename(dest, &bak);
        for sidecar in db_sidecar_paths(dest) {
            if sidecar.is_file() {
                let _ = std::fs::remove_file(sidecar);
            }
        }
    }
    std::fs::copy(source, dest).map_err(|e| format!("无法复制数据库: {e}"))?;
    for sidecar in db_sidecar_paths(source) {
        if sidecar.is_file() {
            let name = sidecar
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if let Some(parent) = dest.parent() {
                let _ = std::fs::copy(&sidecar, parent.join(name));
            }
        }
    }
    Ok(())
}

/// 启动时从兄弟安装目录 / 历史备份中择优回收 `yuntuai.db`（按用户+会话+消息计分）。
fn reconcile_database_on_startup() -> Result<bool, String> {
    let primary = paths::db_file_path()?;
    let candidates = collect_reconcile_database_candidates(&primary)?;
    let primary_score = db_user_data_score(&primary).unwrap_or(0);
    let Some((best_score, source)) = pick_best_database_candidate(&candidates) else {
        return Ok(false);
    };
    if same_db_path(&source, &primary) || best_score <= primary_score {
        return Ok(false);
    }
    let primary_mtime = db_mtime_ms(&primary);
    let source_mtime = db_mtime_ms(&source);
    let gap = best_score.saturating_sub(primary_score);
    let close = primary_score > 0 && gap <= (primary_score / 5).max(1_000_000);
    if close && primary_mtime >= source_mtime {
        eprintln!(
            "[YunTuAI] database reconcile: keep newer primary (score {primary_score}, backup {best_score})"
        );
        return Ok(false);
    }

    copy_db_tree(&source, &primary)?;
    eprintln!(
        "[YunTuAI] database reconcile: restored richer user data from {} (score {best_score} > {primary_score})",
        source.display()
    );
    Ok(true)
}

pub fn init_db() -> Result<Connection, String> {
    eprintln!("[YunTuAI DB] init_db: reconcile user data if needed…");
    let _ = reconcile_database_on_startup();
    eprintln!("[YunTuAI DB] init_db: opening connection…");
    // 尝试打开现有 DB；若损坏则备份并重建
    let c = match open_conn() {
        Ok(c) => {
            eprintln!("[YunTuAI DB] init_db: connection opened ok");
            c
        }
        Err(e) => {
            eprintln!("[YunTuAI DB] init_db: open failed — {e}");
            if let Ok(path) = paths::db_file_path() {
                if path.exists() {
                    let bak = path.with_extension("db.corrupt.bak");
                    let bak_name = bak.to_string_lossy().to_string();
                    let _ = std::fs::rename(&path, &bak);
                    eprintln!("[YunTuAI DB] init_db: corrupt DB backed up to {bak_name}");
                }
            }
            let _ = reconcile_database_on_startup();
            eprintln!("[YunTuAI DB] init_db: retrying open after reconcile…");
            open_conn()?
        }
    };
    eprintln!("[YunTuAI DB] init_db: PRAGMA foreign_keys");
    c.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    eprintln!("[YunTuAI DB] init_db: apply_schema_migrations");
    apply_schema_migrations(&c)?;
    if let Ok(n) = c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get::<_, i64>(0)) {
        let _ = crate::install_seal::ensure_install_seal_from_existing_users(n);
    }
    // WAL 降低同机并发读写时的锁争用；失败不阻断启动，仅回退为默认模式
    eprintln!("[YunTuAI DB] init_db: PRAGMA journal_mode=WAL");
    let _ = c.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0));
    // 等待锁、避免多标签/多操作同时写时出现 SQLITE_BUSY；NORMAL + WAL 适合本机单库
    eprintln!("[YunTuAI DB] init_db: PRAGMA busy_timeout/synchronous/temp_store");
    c.execute_batch(
        "PRAGMA busy_timeout = 10000;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;",
    )
    .map_err(|e| e.to_string())?;
    eprintln!("[YunTuAI DB] init_db: done");
    Ok(c)
}

fn open_independent_db_conn() -> Result<Connection, String> {
    let conn = Connection::open(paths::db_file_path()?).map_err(|e| e.to_string())?;
    let _ = conn.busy_timeout(Duration::from_secs(8));
    let _ = conn.execute_batch("PRAGMA query_only = ON;");
    Ok(conn)
}

/// 启动后异步备份账号库，勿阻塞 setup 的 30s 硬超时（大库 + 杀毒扫描 durable 路径时易误报超时）。
pub fn spawn_durable_account_backup(_conn: std::sync::Arc<std::sync::Mutex<Connection>>) {
    std::thread::Builder::new()
        .name("yuntuai-durable-db-backup".into())
        .spawn(move || {
            // 避开启动后首轮 auth/gateway IPC；独立连接备份，避免长时间占着 UI 热路径同一把 Mutex。
            std::thread::sleep(Duration::from_secs(3));
            let src = match open_independent_db_conn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[YunTuAI DB] durable account backup skipped (open): {e}");
                    return;
                }
            };
            if let Err(e) = persist_durable_account_backup(&src) {
                eprintln!("[YunTuAI DB] durable account backup deferred failed: {e}");
            }
        })
        .ok();
}

// --- 本机数据完整性 + 轻量冷备份（SQLite 在线 backup API，避免直接复制 WAL 时文件不一致）---

#[derive(Debug, Deserialize, Serialize, Default)]
struct BackupMeta {
    #[serde(default)]
    last_backup_ms: u64,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn run_integrity_check(conn: &Connection) -> Result<DbIntegrityResult, String> {
    let mut lines: Vec<String> = Vec::new();
    {
        let mut stmt = conn.prepare("PRAGMA quick_check").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            lines.push(row.map_err(|e| e.to_string())?);
        }
    }
    let ok = lines.len() == 1 && lines[0] == "ok";
    let detail = if lines.is_empty() {
        "（无返回）".to_string()
    } else {
        lines.join("\n")
    };
    let schema_version = read_schema_version(conn)?;
    Ok(DbIntegrityResult {
        ok,
        detail,
        schema_version,
        expected_schema_version: CURRENT_SCHEMA_VERSION,
    })
}

fn run_sqlite_backup_to_path(src: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut dest_conn = Connection::open(dest).map_err(|e| e.to_string())?;
    {
        let bkp = Backup::new(src, &mut dest_conn).map_err(|e| e.to_string())?;
        // 大步进、不 sleep：原先每 20 页停 100ms，大库会卡几十秒。
        bkp.run_to_completion(i32::MAX, Duration::from_millis(0), None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 将当前账号/对话库备份到 `%LOCALAPPDATA%\YunTuAI-Auth\data\yuntuai.db`（覆盖升级可找回）。
pub(crate) fn persist_durable_account_backup(conn: &Connection) -> Result<(), String> {
    let users: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    if users <= 0 {
        return Ok(());
    }
    let dest = paths::durable_account_db_path()?;
    run_sqlite_backup_to_path(conn, &dest)
}

fn prune_backups_in_dir(dir: &Path, keep: usize) -> Result<(), String> {
    let mut with_mtime: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    let rd = match fs::read_dir(dir) {
        Ok(x) => x,
        Err(_) => return Ok(()),
    };
    for e in rd {
        let e = e.map_err(|e| e.to_string())?;
        let p = e.path();
        let name = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if !name.starts_with(BACKUP_NAME_PREFIX) || !name.ends_with(BACKUP_NAME_SUFFIX) {
            continue;
        }
        let mt = e
            .metadata()
            .map_err(|e| e.to_string())?
            .modified()
            .map_err(|e| e.to_string())?;
        with_mtime.push((mt, p));
    }
    with_mtime.sort_by_key(|b| std::cmp::Reverse(b.0));
    for (_, path) in with_mtime.iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// 在启动或退出时尝试：与上次间隔 ≥6h 则生成新备份，并只保留最近 N 个。
pub fn try_autobackup(conn: &Mutex<Connection>) -> Result<Option<String>, String> {
    let dir = paths::data_dir()?;
    let meta_path = dir.join("backup_meta.json");
    let mut last = 0u64;
    if meta_path.exists() {
        if let Ok(raw) = fs::read_to_string(&meta_path) {
            if let Ok(m) = serde_json::from_str::<BackupMeta>(strip_bom(&raw)) {
                last = m.last_backup_ms;
            }
        }
    }
    let now = now_ms();
    if last > 0 && now.saturating_sub(last) < MIN_BACKUP_INTERVAL_MS {
        return Ok(None);
    }
    let dest = dir.join(format!(
        "{BACKUP_NAME_PREFIX}{now}{BACKUP_NAME_SUFFIX}"
    ));
    let src = open_independent_db_conn()?;
    run_sqlite_backup_to_path(&src, &dest)?;
    let meta = BackupMeta { last_backup_ms: now };
    if let Ok(s) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(&meta_path, s);
    }
    prune_backups_in_dir(&dir, KEEP_BACKUP_FILES)?;
    let _ = persist_durable_account_backup(&src);
    let _ = conn;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbIntegrityResult {
    pub ok: bool,
    pub detail: String,
    #[serde(default)]
    pub schema_version: i32,
    #[serde(default)]
    pub expected_schema_version: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbMaintenanceResult {
    pub integrity_ok: bool,
    pub integrity_detail: String,
    #[serde(default)]
    pub schema_version: i32,
    #[serde(default)]
    pub expected_schema_version: i32,
    pub audit_deleted_by_age: u64,
    pub audit_deleted_by_cap: u64,
    pub sessions_deleted: u64,
    pub messages_deleted: u64,
    pub tasks_deleted: u64,
    pub login_attempts_deleted: u64,
    pub tokens_deleted: u64,
    pub wal_checkpointed: bool,
    pub vacuum_ran: bool,
    pub backup_path: Option<String>,
    #[serde(default)]
    pub archived_sessions: u64,
    #[serde(default)]
    pub archived_messages: u64,
}

#[derive(Debug, Default)]
pub(crate) struct RetentionPruneStats {
    sessions_deleted: u64,
    messages_deleted: u64,
    tasks_deleted: u64,
    login_attempts_deleted: u64,
    tokens_deleted: u64,
}

/// 裁剪审计日志：按天数 + 行数上限，避免长期驻留导致库膨胀。
pub(crate) fn prune_audit_log(conn: &Connection) -> Result<(u64, u64), String> {
    let cutoff = now_ms().saturating_sub(AUDIT_RETENTION_DAYS.saturating_mul(24 * 60 * 60 * 1000));
    let by_age = conn
        .execute(
            "DELETE FROM audit_log WHERE CAST(created_at AS INTEGER) > 0 AND CAST(created_at AS INTEGER) < ?1",
            params![cutoff as i64],
        )
        .map_err(|e| e.to_string())? as u64;
    let by_cap = conn
        .execute(
            "DELETE FROM audit_log WHERE rowid NOT IN (
                SELECT rowid FROM audit_log ORDER BY created_at DESC LIMIT ?1
            )",
            params![AUDIT_MAX_ROWS],
        )
        .map_err(|e| e.to_string())? as u64;
    Ok((by_age, by_cap))
}

pub(crate) fn checkpoint_wal(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE);")
        .map_err(|e| e.to_string())
}

fn delete_session_cascade(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM local_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM local_tasks WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM local_sessions WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    crate::session_archive::remove_archive_file(session_id);
    Ok(())
}

/// 按用户裁剪会话/消息/任务，并清理登录尝试与过期 token。
pub(crate) fn prune_user_data_retention(
    conn: &Connection,
    user_id: &str,
) -> Result<RetentionPruneStats, String> {
    let mut stats = RetentionPruneStats::default();

    let session_ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT id FROM local_sessions WHERE user_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        rows
    };

    for sid in &session_ids {
        let n = conn
            .execute(
                "DELETE FROM local_messages WHERE session_id = ?1 AND rowid NOT IN (
                    SELECT rowid FROM local_messages WHERE session_id = ?1
                    ORDER BY CAST(created_at AS INTEGER) DESC, rowid DESC LIMIT ?2
                )",
                params![sid, MESSAGES_MAX_PER_SESSION],
            )
            .map_err(|e| e.to_string())?;
        stats.messages_deleted += n as u64;
    }

    let excess_sessions: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM local_sessions WHERE user_id = ?1 AND id NOT IN (
                    SELECT id FROM local_sessions WHERE user_id = ?1
                    ORDER BY CAST(updated_at AS INTEGER) DESC, rowid DESC LIMIT ?2
                )",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id, SESSION_MAX_ROWS], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        rows
    };
    for sid in excess_sessions {
        delete_session_cascade(conn, &sid)?;
        stats.sessions_deleted += 1;
    }

    let n = conn
        .execute(
            "DELETE FROM local_tasks WHERE user_id = ?1 AND rowid NOT IN (
                SELECT rowid FROM local_tasks WHERE user_id = ?1
                ORDER BY CAST(updated_at AS INTEGER) DESC, rowid DESC LIMIT ?2
            )",
            params![user_id, TASK_MAX_ROWS],
        )
        .map_err(|e| e.to_string())?;
    stats.tasks_deleted += n as u64;

    let cutoff = now_ms().saturating_sub(LOGIN_ATTEMPTS_RETENTION_DAYS.saturating_mul(24 * 60 * 60 * 1000));
    stats.login_attempts_deleted += conn
        .execute(
            "DELETE FROM login_attempts WHERE CAST(created_at AS INTEGER) > 0 AND CAST(created_at AS INTEGER) < ?1",
            params![cutoff as i64],
        )
        .map_err(|e| e.to_string())? as u64;
    stats.login_attempts_deleted += conn
        .execute(
            "DELETE FROM login_attempts WHERE rowid NOT IN (
                SELECT rowid FROM login_attempts ORDER BY created_at DESC LIMIT ?1
            )",
            params![LOGIN_ATTEMPTS_MAX_ROWS],
        )
        .map_err(|e| e.to_string())? as u64;

    stats.tokens_deleted = conn
        .execute(
            "DELETE FROM auth_tokens WHERE expires_at IS NOT NULL AND CAST(expires_at AS INTEGER) < ?1",
            params![now_ms() as i64],
        )
        .map_err(|e| e.to_string())? as u64;

    Ok(stats)
}

fn db_mtime_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn apply_runtime_pragmas(conn: &Connection) -> Result<(), String> {
    let _ = conn.busy_timeout(Duration::from_secs(8));
    let _ = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get::<_, String>(0));
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 10000;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;",
    )
    .map_err(|e| e.to_string())
}

/// VACUUM 需要关掉其它连接。维护时暂时换出主连接，压完再打开，避免主连接占着文件导致永远压不动。
fn maybe_vacuum(conn_mutex: &Mutex<Connection>, total_deleted: u64) -> Result<bool, String> {
    if total_deleted < VACUUM_MIN_DELETED_ROWS {
        return Ok(false);
    }
    let mut guard = lock_conn(conn_mutex);
    let _ = guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    let path = paths::db_file_path()?;
    let closed = std::mem::replace(
        &mut *guard,
        Connection::open_in_memory().map_err(|e| e.to_string())?,
    );
    drop(closed);
    let vacuumed = match Connection::open(&path) {
        Ok(vacuum_conn) => {
            let _ = vacuum_conn.busy_timeout(Duration::from_secs(3));
            let ok = vacuum_conn.execute_batch("VACUUM;").is_ok();
            drop(vacuum_conn);
            ok
        }
        Err(e) => {
            eprintln!("[YunTuAI DB] vacuum open failed: {e}");
            false
        }
    };
    let reopened = Connection::open(&path).map_err(|e| format!("维护后重新打开数据库失败: {e}"))?;
    if let Err(e) = apply_runtime_pragmas(&reopened) {
        eprintln!("[YunTuAI DB] pragmas after vacuum: {e}");
    }
    *guard = reopened;
    Ok(vacuumed)
}

#[tauri::command]
pub async fn db_check_integrity(
    state: State<'_, DbState>,
    token: String,
) -> Result<DbIntegrityResult, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = lock_conn(&conn);
        let _ = resolve_authenticated_user(&conn, &token)?;
        run_integrity_check(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_run_maintenance(
    state: State<'_, DbState>,
    token: String,
) -> Result<DbMaintenanceResult, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (integrity, user_id) = {
            let conn = lock_conn(&conn);
            let user = resolve_authenticated_user(&conn, &token)?;
            (run_integrity_check(&conn)?, user.0)
        };
        let (
            audit_deleted_by_age,
            audit_deleted_by_cap,
            retention,
            archive_stats,
            wal_checkpointed,
            vacuum_ran,
        ) = {
            let db = conn.clone();
            let conn = lock_conn(&conn);
            let pruned = prune_audit_log(&conn)?;
            let archive_stats =
                crate::session_archive::apply_session_cold_storage(&conn, &user_id)?;
            let retention = prune_user_data_retention(&conn, &user_id)?;
            let wal_ok = checkpoint_wal(&conn).is_ok();
            let total_deleted = pruned.0
                + pruned.1
                + retention.sessions_deleted
                + retention.messages_deleted
                + retention.tasks_deleted
                + retention.login_attempts_deleted
                + retention.tokens_deleted
                + archive_stats.archived_messages;
            drop(conn);
            let vacuum_ran = match maybe_vacuum(&db, total_deleted) {
                Ok(ran) => ran,
                Err(e) => {
                    eprintln!("[YunTuAI DB] vacuum skipped: {e}");
                    false
                }
            };
            (
                pruned.0,
                pruned.1,
                retention,
                archive_stats,
                wal_ok,
                vacuum_ran,
            )
        };
        let backup_path = try_autobackup(&conn).unwrap_or(None);
        Ok(DbMaintenanceResult {
            integrity_ok: integrity.ok,
            integrity_detail: integrity.detail,
            schema_version: integrity.schema_version,
            expected_schema_version: integrity.expected_schema_version,
            audit_deleted_by_age,
            audit_deleted_by_cap,
            sessions_deleted: retention.sessions_deleted,
            messages_deleted: retention.messages_deleted,
            tasks_deleted: retention.tasks_deleted,
            login_attempts_deleted: retention.login_attempts_deleted,
            tokens_deleted: retention.tokens_deleted,
            wal_checkpointed,
            vacuum_ran,
            backup_path,
            archived_sessions: archive_stats.archived_sessions,
            archived_messages: archive_stats.archived_messages,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_try_autobackup(
    state: State<'_, DbState>,
    token: String,
) -> Result<Option<String>, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let c = lock_conn(&conn);
        let _ = resolve_authenticated_user(&c, &token)?;
        drop(c);
        try_autobackup(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionRow {
    pub id: String,
    pub title: String,
    pub remote_session_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// 该会话最后一条本地消息时间（用于侧栏展示，避免元数据同步误刷 updated_at）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message_at: Option<String>,
}

#[tauri::command]
pub async fn db_list_sessions(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<LocalSessionRow>, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = lock_conn(&conn);
        let user_id = resolve_authenticated_user_id(&conn, &token)?;
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.title, s.remote_session_key, s.agent_id, s.created_at, s.updated_at,
              COALESCE(
                s.last_message_at_cache,
                (SELECT MAX(m.created_at) FROM local_messages m WHERE m.session_id = s.id)
              ) AS last_message_at
             FROM local_sessions s
             WHERE s.user_id = ?1
             ORDER BY COALESCE(last_message_at, s.updated_at) DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id], |r| {
                Ok(LocalSessionRow {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    remote_session_key: r.get(2)?,
                    agent_id: r.get(3)?,
                    created_at: r.get(4)?,
                    updated_at: r.get(5)?,
                    last_message_at: r.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn db_create_session(
    state: State<'_, DbState>,
    token: String,
    title: String,
    agent_id: Option<String>,
) -> Result<LocalSessionRow, String> {
    let title = normalize_new_session_title(title);
    let agent_id: Option<String> = agent_id
        .map(|a: String| a.trim().chars().take(256).collect())
        .filter(|a: &String| !a.is_empty());
    let id = new_id();
    let now = now_iso();
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    conn.execute(
        "INSERT INTO local_sessions (id, title, remote_session_key, agent_id, user_id, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)",
        params![id, title, agent_id, user_id, now, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(LocalSessionRow {
        id,
        title,
        remote_session_key: None,
        agent_id,
        created_at: now.clone(),
        updated_at: now,
        last_message_at: None,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMessageRow {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    /// 气泡展示用短文案；为 None 时前端使用 `content`（与完整正文相同）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageListPage {
    pub messages: Vec<LocalMessageRow>,
    pub has_more: bool,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn db_append_message(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    role: String,
    content: String,
    display_content: Option<String>,
    touch_session_updated_at: Option<bool>,
    created_at: Option<String>,
) -> Result<LocalMessageRow, String> {
    const MAX_DISPLAY_BYTES: usize = 16 * 1024;
    let session_id = norm_session_id(&session_id)?;
    let role: String = role.trim().chars().take(MAX_ROLE_CHARS).collect();
    if role.is_empty() {
        return Err("role 不能为空".into());
    }
    if content.is_empty() {
        return Err("消息内容不能为空".into());
    }
    if content.len() > MAX_MSG_BYTES {
        return Err(format!(
            "消息内容过长（超过 {}MB）",
            MAX_MSG_BYTES / (1024 * 1024)
        ));
    }
    let display_content: Option<String> = display_content
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            if s.len() <= MAX_DISPLAY_BYTES {
                s
            } else {
                s.chars().take(MAX_DISPLAY_BYTES).collect()
            }
        });
    let id = new_id();
    let mut now = now_iso();
    if let Some(ref custom) = created_at {
        let t = custom.trim();
        if !t.is_empty() {
            let n: i64 = t.parse().map_err(|_| "created_at 须为毫秒时间戳".to_string())?;
            if n <= 0 {
                return Err("created_at 无效".into());
            }
            now = t.to_string();
        }
    }
    let touch = touch_session_updated_at.unwrap_or(true);
    let content_ret = content.clone();
    let display_ret = display_content.clone();
    let role_ret = role.clone();
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = lock_conn(&conn);
        let user_id = resolve_authenticated_user_id(&conn, &token)?;
        require_session_owned(&conn, &session_id, &user_id)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO local_messages (id, session_id, role, content, created_at, display_content) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, session_id, role, content, now, display_content],
        )
        .map_err(|e| e.to_string())?;
        if touch {
            tx.execute(
                "UPDATE local_sessions SET updated_at = ?1 WHERE id = ?2",
                params![now, session_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(LocalMessageRow {
            id,
            session_id,
            role: role_ret,
            content: content_ret,
            created_at: now,
            display_content: display_ret,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_list_messages(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    limit: Option<u32>,
    before_created_at: Option<String>,
) -> Result<MessageListPage, String> {
    let session_id = norm_session_id(&session_id)?;
    let lim = limit.unwrap_or(400).clamp(1, 2000) as i64;
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let fetch = lim + 1;
        let mut conn = lock_conn(&conn);
        let user_id = resolve_authenticated_user_id(&conn, &token)?;
        require_session_owned(&conn, &session_id, &user_id)?;
        let _ = crate::session_archive::restore_archived_session_if_needed(&mut conn, &session_id)?;
        let before = before_created_at
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let mut out = Vec::new();
        if let Some(ref cursor) = before {
            let mut stmt = conn
                .prepare(
                    "SELECT id, session_id, role, content, created_at, display_content FROM local_messages WHERE session_id = ?1 AND created_at < ?2 ORDER BY created_at DESC LIMIT ?3",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![session_id, cursor, fetch], |r| {
                    Ok(LocalMessageRow {
                        id: r.get(0)?,
                        session_id: r.get(1)?,
                        role: r.get(2)?,
                        content: r.get(3)?,
                        created_at: r.get(4)?,
                        display_content: r.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                out.push(row.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn
                .prepare(
                    "SELECT id, session_id, role, content, created_at, display_content FROM local_messages WHERE session_id = ?1 ORDER BY created_at DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![session_id, fetch], |r| {
                    Ok(LocalMessageRow {
                        id: r.get(0)?,
                        session_id: r.get(1)?,
                        role: r.get(2)?,
                        content: r.get(3)?,
                        created_at: r.get(4)?,
                        display_content: r.get(5)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                out.push(row.map_err(|e| e.to_string())?);
            }
        }
        let has_more = out.len() as i64 > lim;
        if has_more {
            out.truncate(lim as usize);
        }
        out.reverse();
        Ok(MessageListPage {
            messages: out,
            has_more,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 清空某会话下的全部本地消息（保留会话行与 remote_session_key）。
#[tauri::command]
pub fn db_clear_session_messages(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let mut conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let now = now_iso();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM local_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE local_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 删除单条本地消息（仅该会话下、且 id 匹配时生效；成功则更新会话 `updated_at`）。
#[tauri::command]
pub fn db_delete_message(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    message_id: String,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let message_id = norm_session_id(&message_id)?;
    let mut conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let now = now_iso();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let n = tx
        .execute(
            "DELETE FROM local_messages WHERE id = ?1 AND session_id = ?2",
            params![message_id, session_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("未找到该消息或已删除".into());
    }
    tx.execute(
        "UPDATE local_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// 只清登录回填抄进来的副本。
/// 纯「输出目录」提示整段删除。带这段提示、且正文完全相同的回填副本只留最早一条。
/// 客户自己先后发出的相同句子（正文里没有这段提示）不删。
/// 同一段被原样复制很多遍（至少 8 条）时，只留最早一条。
pub(crate) fn collapse_replayed_messages(conn: &Connection, session_id: &str) -> Result<u64, String> {
    let hint_only = conn
        .execute(
            "DELETE FROM local_messages
             WHERE session_id = ?1 AND role = 'user'
               AND ltrim(content) LIKE '【输出目录】%'",
            params![session_id],
        )
        .map_err(|e| e.to_string())? as u64;
    let injected = conn
        .execute(
            "DELETE FROM local_messages
             WHERE id IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (
                          PARTITION BY role, content
                          ORDER BY CAST(created_at AS INTEGER), rowid
                        ) AS rn
                 FROM local_messages
                 WHERE session_id = ?1
                   AND content LIKE '%【输出目录】%'
               )
               WHERE rn > 1
             )",
            params![session_id],
        )
        .map_err(|e| e.to_string())? as u64;
    let mass = conn
        .execute(
            "DELETE FROM local_messages
             WHERE id IN (
               SELECT id FROM (
                 SELECT id,
                        ROW_NUMBER() OVER (
                          PARTITION BY role, content
                          ORDER BY CAST(created_at AS INTEGER), rowid
                        ) AS rn,
                        COUNT(*) OVER (PARTITION BY role, content) AS cnt
                 FROM local_messages
                 WHERE session_id = ?1
               )
               WHERE cnt >= 8 AND rn > 1
             )",
            params![session_id],
        )
        .map_err(|e| e.to_string())? as u64;
    Ok(hint_only + injected + mass)
}

#[tauri::command]
pub async fn db_collapse_replayed_messages(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
) -> Result<u64, String> {
    let session_id = norm_session_id(&session_id)?;
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = lock_conn(&conn);
        let user_id = resolve_authenticated_user_id(&conn, &token)?;
        require_session_owned(&conn, &session_id, &user_id)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let removed = collapse_replayed_messages(&tx, &session_id)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok::<u64, String>(removed)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn db_delete_session(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let mut conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM local_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM local_tasks WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM local_sessions WHERE id = ?1", params![session_id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_update_session_title(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let title: String = title.trim().chars().take(200).collect();
    if title.is_empty() {
        return Err("标题不能为空".into());
    }
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let n = conn
        .execute(
            "UPDATE local_sessions SET title = ?1 WHERE id = ?2",
            params![title, session_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("未找到该会话".into());
    }
    Ok(())
}

#[tauri::command]
pub fn db_set_remote_session_key(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    remote_session_key: String,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let key: String = remote_session_key
        .trim()
        .chars()
        .take(MAX_REMOTE_KEY_CHARS)
        .collect();
    if key.is_empty() {
        return Err("remote_session_key 不能为空".into());
    }
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let n = conn
        .execute(
            "UPDATE local_sessions SET remote_session_key = ?1 WHERE id = ?2",
            params![key, session_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("未找到该会话".into());
    }
    Ok(())
}

#[tauri::command]
pub fn db_set_session_agent(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    agent_id: Option<String>,
) -> Result<(), String> {
    let session_id = norm_session_id(&session_id)?;
    let agent_id: Option<String> = agent_id
        .map(|a: String| a.trim().chars().take(256).collect())
        .filter(|a: &String| !a.is_empty());
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_session_owned(&conn, &session_id, &user_id)?;
    let n = conn
        .execute(
            "UPDATE local_sessions SET agent_id = ?1 WHERE id = ?2",
            params![agent_id, session_id],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("未找到该会话".into());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogRow {
    pub id: String,
    pub created_at: String,
    pub category: String,
    pub action: String,
    pub detail: String,
}

/// Internal: append one audit row (CLI, UI, etc.).
#[allow(dead_code)]
pub fn audit_insert(
    state: &State<'_, DbState>,
    category: &str,
    action: &str,
    detail: &str,
) -> Result<(), String> {
    let conn = lock_conn(&state.conn);
    audit_insert_on_conn(&conn, category, action, detail)
}

/// 同 audit_insert，但在已持有连接锁的情况下使用，避免 std::sync::Mutex 死锁。
pub fn audit_insert_on_conn(
    conn: &Connection,
    category: &str,
    action: &str,
    detail: &str,
) -> Result<(), String> {
    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO audit_log (id, created_at, category, action, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, now, category, action, detail],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn fetch_audit_rows(conn: &Connection, limit: i64) -> Result<Vec<AuditLogRow>, String> {
    let lim = limit.clamp(1, 10_000);
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, category, action, detail FROM audit_log ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![lim], |r| {
            Ok(AuditLogRow {
                id: r.get(0)?,
                created_at: r.get(1)?,
                category: r.get(2)?,
                action: r.get(3)?,
                detail: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 由前端记录 UI 侧高级操作（如原始 RPC），与 CLI 审计互补。
#[tauri::command]
pub fn audit_append_event(
    state: State<'_, DbState>,
    token: String,
    category: String,
    action: String,
    detail: String,
) -> Result<(), String> {
    let conn = lock_conn(&state.conn);
    let _ = resolve_authenticated_user(&conn, &token)?;
    let category: String = category.trim().chars().take(64).collect();
    if category.is_empty() {
        return Err("category 不能为空".into());
    }
    const ALLOWED: &[&str] = &["advanced", "ui", "gateway", "session"];
    if !ALLOWED.contains(&category.as_str()) {
        return Err(format!("不允许的审计类别: {category}"));
    }
    let action: String = action.trim().chars().take(128).collect();
    let detail = truncate_audit_detail(&detail, 16_384);
    audit_insert_on_conn(&conn, &category, &action, &detail)
}

#[tauri::command]
pub fn audit_list(
    state: State<'_, DbState>,
    token: String,
    limit: i64,
) -> Result<Vec<AuditLogRow>, String> {
    crate::owner::assert_owner(&state, &token)?;
    let conn = lock_conn(&state.conn);
    fetch_audit_rows(&conn, limit)
}

#[tauri::command]
pub fn audit_export_json(state: State<'_, DbState>, token: String) -> Result<String, String> {
    crate::owner::assert_owner(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let rows = fetch_audit_rows(&conn, 10_000)?;
    serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())
}

pub(crate) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn now_iso() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // ISO-like UTC (good enough for ordering)
    format!("{}", ms)
}

fn normalize_task_status(raw: &str) -> Result<String, String> {
    let s = raw.trim().to_ascii_lowercase();
    match s.as_str() {
        "pending" | "running" | "completed" | "partial" | "failed" | "cancelled" => Ok(s),
        _ => Err(format!("无效任务状态: {raw}")),
    }
}

fn require_task_owned(conn: &Connection, task_id: &str, user_id: &str) -> Result<(), String> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT user_id FROM local_tasks WHERE id = ?1",
            params![task_id],
            |r| r.get(0),
        )
        .map_err(|e| {
            if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                "未找到该任务或已删除".into()
            } else {
                e.to_string()
            }
        })?;
    match owner {
        None => Err("任务数据异常".into()),
        Some(ref oid) if oid == user_id => Ok(()),
        Some(_) => Err("无权访问此任务".into()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTaskRow {
    pub id: String,
    pub session_id: Option<String>,
    pub title: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

fn map_task_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<LocalTaskRow> {
    Ok(LocalTaskRow {
        id: r.get(0)?,
        session_id: r.get(1)?,
        title: r.get(2)?,
        status: r.get(3)?,
        template_id: r.get(4)?,
        capability_snapshot: r.get(5)?,
        outcome: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        completed_at: r.get(9)?,
    })
}

const TASK_SELECT: &str = "SELECT id, session_id, title, status, template_id, capability_snapshot, outcome, created_at, updated_at, completed_at FROM local_tasks";

#[tauri::command]
pub fn db_create_task(
    state: State<'_, DbState>,
    token: String,
    title: String,
    session_id: Option<String>,
    template_id: Option<String>,
    capability_snapshot: Option<String>,
) -> Result<LocalTaskRow, String> {
    let title: String = title.trim().chars().take(200).collect();
    if title.is_empty() {
        return Err("任务标题不能为空".into());
    }
    let session_id = match session_id {
        Some(s) => Some(norm_session_id(&s)?),
        None => None,
    };
    let template_id: Option<String> = template_id
        .map(|t| t.trim().chars().take(128).collect::<String>())
        .filter(|t| !t.is_empty());
    let capability_snapshot: Option<String> = capability_snapshot
        .map(|c| c.chars().take(32_768).collect::<String>())
        .filter(|c| !c.is_empty());

    let id = new_id();
    let now = now_iso();
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    if let Some(ref sid) = session_id {
        require_session_owned(&conn, sid, &user_id)?;
    }
    conn.execute(
        "INSERT INTO local_tasks (id, user_id, session_id, title, status, template_id, capability_snapshot, outcome, created_at, updated_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, NULL, ?7, ?8, NULL)",
        params![
            id,
            user_id,
            session_id,
            title,
            template_id,
            capability_snapshot,
            now,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(LocalTaskRow {
        id,
        session_id,
        title,
        status: "running".into(),
        template_id,
        capability_snapshot,
        outcome: None,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
    })
}

#[tauri::command]
pub fn db_list_tasks(
    state: State<'_, DbState>,
    token: String,
    limit: Option<u32>,
    session_id: Option<String>,
) -> Result<Vec<LocalTaskRow>, String> {
    let lim = limit.unwrap_or(30).clamp(1, 200) as i64;
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    let session_id = match session_id {
        Some(s) => Some(norm_session_id(&s)?),
        None => None,
    };
    if let Some(ref sid) = session_id {
        require_session_owned(&conn, sid, &user_id)?;
        let mut stmt = conn
            .prepare(&format!(
                "{TASK_SELECT} WHERE user_id = ?1 AND session_id = ?2 ORDER BY updated_at DESC LIMIT ?3"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![user_id, sid, lim], map_task_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        return Ok(out);
    }
    let mut stmt = conn
        .prepare(&format!(
            "{TASK_SELECT} WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT ?2"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user_id, lim], map_task_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn db_update_task_status(
    state: State<'_, DbState>,
    token: String,
    task_id: String,
    status: String,
    outcome: Option<String>,
) -> Result<LocalTaskRow, String> {
    let task_id = task_id.trim();
    if task_id.is_empty() || task_id.len() > 128 {
        return Err("task_id 无效".into());
    }
    let status = normalize_task_status(&status)?;
    let outcome: Option<String> = outcome
        .map(|o| o.chars().take(64_000).collect::<String>())
        .filter(|o| !o.is_empty());
    let now = now_iso();
    let completed_at = matches!(status.as_str(), "completed" | "partial" | "failed" | "cancelled")
        .then(|| now.clone());

    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_task_owned(&conn, task_id, &user_id)?;
    conn.execute(
        "UPDATE local_tasks SET status = ?1, outcome = COALESCE(?2, outcome), updated_at = ?3, completed_at = COALESCE(?4, completed_at) WHERE id = ?5",
        params![status, outcome, now, completed_at, task_id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("{TASK_SELECT} WHERE id = ?1"),
        params![task_id],
        map_task_row,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_task(
    state: State<'_, DbState>,
    token: String,
    task_id: String,
) -> Result<LocalTaskRow, String> {
    let task_id = task_id.trim();
    if task_id.is_empty() || task_id.len() > 128 {
        return Err("task_id 无效".into());
    }
    let conn = lock_conn(&state.conn);
    let user_id = resolve_authenticated_user_id(&conn, &token)?;
    require_task_owned(&conn, task_id, &user_id)?;
    conn.query_row(
        &format!("{TASK_SELECT} WHERE id = ?1"),
        params![task_id],
        map_task_row,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn norm_session_id_rejects_blank() {
        assert!(norm_session_id("   ").is_err());
    }

    #[test]
    fn truncate_audit_detail_respects_char_boundary() {
        let detail = "你好".repeat(9000);
        let out = truncate_audit_detail(&detail, 16_384);
        assert!(out.ends_with("…(truncated)"));
        assert!(out.chars().count() <= 16_384 + 16);
    }

    #[test]
    fn normalize_task_status_accepts_known() {
        assert_eq!(normalize_task_status("Running").unwrap(), "running");
        assert!(normalize_task_status("bogus").is_err());
    }

    fn open_test_conn() -> Connection {
        let c = Connection::open_in_memory().expect("in-memory db");
        c.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign_keys");
        apply_schema_migrations(&c).expect("migrate");
        c
    }

    #[test]
    fn legacy_install_fast_stamps_schema_version_without_full_migration() {
        let c = Connection::open_in_memory().expect("in-memory db");
        c.execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign_keys");
        migrate(&c).expect("migrate");
        ensure_local_sessions_agent_id(&c).expect("agent_id");
        ensure_local_sessions_user_id(&c).expect("user_id");
        ensure_users_lock_columns(&c).expect("lock");
        ensure_users_role(&c).expect("role");
        ensure_local_tasks(&c).expect("tasks");
        ensure_local_messages_display_content(&c).expect("display_content");
        ensure_auth_tokens_expires_at(&c).expect("expires_at");
        ensure_meeting_tables(&c).expect("meeting");
        ensure_gateway_events(&c).expect("gateway_events");
        assert!(legacy_install_missing_schema_stamp(&c).unwrap());
        apply_schema_migrations(&c).expect("apply");
        let version: i32 = c
            .query_row(
                "SELECT version FROM schema_version WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .expect("schema_version");
        assert_eq!(version, 1);
    }

    #[test]
    fn integrity_check_reports_schema_version() {
        let conn = open_test_conn();
        let result = run_integrity_check(&conn).expect("integrity");
        assert!(result.ok);
        assert_eq!(result.schema_version, 1);
        assert_eq!(result.expected_schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn schema_version_initialized_after_migrate() {
        let conn = open_test_conn();
        let version: i32 = conn
            .query_row(
                "SELECT version FROM schema_version WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .expect("schema_version");
        assert_eq!(version, 1);
    }

    #[test]
    fn prune_user_data_retention_trims_sessions_and_messages() {
        let conn = open_test_conn();
        let user = "u1";
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, 'hash', ?3)",
            params![user, "tester", now_iso()],
        )
        .unwrap();
        for i in 0..(SESSION_MAX_ROWS + 3) {
            let sid = format!("s{i}");
            conn.execute(
                "INSERT INTO local_sessions (id, title, user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![sid, format!("t{i}"), user, format!("{i:020}")],
            )
            .unwrap();
            for j in 0..(MESSAGES_MAX_PER_SESSION + 2) {
                conn.execute(
                    "INSERT INTO local_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, 'user', 'x', ?3)",
                    params![format!("m{i}-{j}"), sid, format!("{j:020}")],
                )
                .unwrap();
            }
        }
        let stats = prune_user_data_retention(&conn, user).expect("prune");
        assert_eq!(stats.sessions_deleted, 3);
        assert!(stats.messages_deleted >= 6);
        let session_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_sessions WHERE user_id = ?1",
                params![user],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(session_count, SESSION_MAX_ROWS);
        let msg_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM local_messages", [], |r| r.get(0))
            .unwrap();
        assert!(msg_count <= SESSION_MAX_ROWS * MESSAGES_MAX_PER_SESSION);
    }

    #[test]
    fn user_data_score_prefers_sessions_over_empty_user_shell() {
        let users_only = db_user_data_score_from_counts(DbUserDataCounts {
            users: 1,
            sessions: 0,
            messages: 0,
        });
        let with_sessions = db_user_data_score_from_counts(DbUserDataCounts {
            users: 1,
            sessions: 25,
            messages: 190,
        });
        assert!(with_sessions > users_only);
    }

    fn seed_test_db(path: &Path, sessions: i64, messages: i64) {
        if path.exists() {
            fs::remove_file(path).expect("remove old test db");
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("mkdir test db parent");
        }
        let conn = Connection::open(path).expect("open test db");
        migrate(&conn).expect("migrate test db");
        apply_schema_migrations(&conn).expect("schema test db");
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'dev', 'hash', '2026-01-01')",
            [],
        )
        .expect("insert user");
        for i in 0..sessions {
            let sid = format!("s{i}");
            conn.execute(
                "INSERT INTO local_sessions (id, title, user_id, created_at, updated_at) VALUES (?1, ?2, 'u1', '1', '1')",
                params![sid, format!("session {i}")],
            )
            .expect("insert session");
            for j in 0..messages {
                conn.execute(
                    "INSERT INTO local_messages (id, session_id, role, content, created_at) VALUES (?1, ?2, 'user', 'hi', '1')",
                    params![format!("m{i}-{j}"), sid],
                )
                .expect("insert message");
            }
        }
    }

    #[test]
    fn pick_best_database_candidate_prefers_richer_sessions() {
        let base = std::env::temp_dir().join(format!(
            "yuntuai-db-reconcile-test-{}",
            now_ms()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("mkdir reconcile test base");
        let sparse = base.join("sparse.db");
        let rich = base.join("rich.db");
        seed_test_db(&sparse, 0, 0);
        seed_test_db(&rich, 3, 2);

        let best = pick_best_database_candidate(&[sparse.clone(), rich.clone()])
            .expect("best candidate");
        assert!(same_db_path(&best.1, &rich));
        assert!(best.0 > db_user_data_score(&sparse).expect("sparse score"));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn collect_reconcile_candidates_includes_backup_files() {
        let base = std::env::temp_dir().join(format!(
            "yuntuai-db-backup-candidate-test-{}",
            now_ms()
        ));
        let data_dir = base.join("data");
        fs::create_dir_all(&data_dir).expect("mkdir data dir");
        let primary = data_dir.join("yuntuai.db");
        seed_test_db(&primary, 0, 0);
        let backup = data_dir.join(format!("{BACKUP_NAME_PREFIX}9999{BACKUP_NAME_SUFFIX}"));
        seed_test_db(&backup, 5, 1);

        let candidates = collect_reconcile_database_candidates(&primary).expect("candidates");
        assert!(candidates.iter().any(|p| same_db_path(p, &primary)));
        assert!(candidates.iter().any(|p| same_db_path(p, &backup)));
        assert!(
            db_user_data_score(&backup).expect("backup score")
                > db_user_data_score(&primary).expect("primary score")
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sqlite_backup_copies_users_to_dest() {
        let base = std::env::temp_dir().join(format!(
            "yuntuai-db-durable-backup-test-{}",
            now_ms()
        ));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).expect("mkdir backup test");
        let src = base.join("src.db");
        seed_test_db(&src, 2, 1);
        let src_conn = Connection::open(&src).expect("open src");
        let dest = base.join("auth").join("data").join("yuntuai.db");
        run_sqlite_backup_to_path(&src_conn, &dest).expect("backup");
        assert!(dest.is_file());
        assert!(db_user_data_score(&dest).expect("dest score") > 0);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn collapse_replayed_messages_keeps_repeated_user_text() {
        let conn = open_test_conn();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 'dev', 'hash', '1')",
            [],
        )
        .expect("user");
        conn.execute(
            "INSERT INTO local_sessions (id, title, user_id, created_at, updated_at) VALUES ('s1', 't', 'u1', '1', '1')",
            [],
        )
        .expect("session");
        let rows = [
            ("a", "1", "user", "好的"),
            ("b", "2", "user", "好的"),
            ("c", "3", "user", "【输出目录】必须保存到 D:\\out"),
            ("d", "4", "user", "【输出目录】必须保存到 D:\\out"),
            (
                "e",
                "5",
                "user",
                "生成报告\n\n---\n【输出目录】必须保存到 D:\\out",
            ),
            (
                "f",
                "6",
                "user",
                "生成报告\n\n---\n【输出目录】必须保存到 D:\\out",
            ),
        ];
        for (id, at, role, content) in rows {
            conn.execute(
                "INSERT INTO local_messages (id, session_id, role, content, created_at) VALUES (?1, 's1', ?2, ?3, ?4)",
                params![id, role, content, at],
            )
            .expect("message");
        }
        for n in 0..8 {
            conn.execute(
                "INSERT INTO local_messages (id, session_id, role, content, created_at) VALUES (?1, 's1', 'assistant', '同一段被复制了很多遍', ?2)",
                params![format!("m{n}"), format!("{}", 10 + n)],
            )
            .expect("mass");
        }
        let removed = collapse_replayed_messages(&conn, "s1").expect("collapse");
        assert!(removed >= 10);
        let count = |content: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM local_messages WHERE session_id = 's1' AND content = ?1",
                params![content],
                |r| r.get(0),
            )
            .expect("count")
        };
        assert_eq!(count("好的"), 2);
        assert_eq!(count("【输出目录】必须保存到 D:\\out"), 0);
        assert_eq!(count("生成报告\n\n---\n【输出目录】必须保存到 D:\\out"), 1);
        assert_eq!(count("同一段被复制了很多遍"), 1);
    }
}
