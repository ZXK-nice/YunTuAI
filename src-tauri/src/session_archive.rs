//! 会话冷存储：超过 15 条或 10 天未活跃的对话消息落盘，按需自动还原。
//! 侧栏元数据仍保留在 SQLite；前端无需改动，打开会话时 `db_list_messages` 自动导入。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::paths;

/// 热会话保留条数（按最近活跃排序，之外的封存消息）。
pub const SESSION_HOT_KEEP: i64 = 15;
/// 超过该天数的会话消息封存（毫秒）。
pub const SESSION_ARCHIVE_AGE_MS: u64 = 10 * 24 * 60 * 60 * 1000;
/// 两次冷存储扫描最小间隔（毫秒），避免侧栏刷新频繁写盘。
#[allow(dead_code)]
const SESSION_COLD_STORAGE_INTERVAL_MS: u64 = 5 * 60 * 1000;

#[allow(dead_code)]
static LAST_COLD_STORAGE_MS: std::sync::Mutex<Option<u64>> = std::sync::Mutex::new(None);

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionArchiveStats {
    pub archived_sessions: u64,
    pub archived_messages: u64,
    pub restored_sessions: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchivedMessageRow {
    id: String,
    session_id: String,
    role: String,
    content: String,
    created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct SessionArchiveFile {
    version: u32,
    session_id: String,
    archived_at: String,
    messages: Vec<ArchivedMessageRow>,
}

pub fn ensure_local_sessions_archive_columns(c: &Connection) -> Result<(), String> {
    for col in ["archived_at", "last_message_at_cache"] {
        let count: i64 = c
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('local_sessions') WHERE name = '{col}'"
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if count == 0 {
            c.execute(
                &format!("ALTER TABLE local_sessions ADD COLUMN {col} TEXT"),
                [],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn archive_dir() -> Result<PathBuf, String> {
    let dir = paths::data_dir()?.join("archive").join("sessions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn archive_file_path(session_id: &str) -> Result<PathBuf, String> {
    let safe = session_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if safe.is_empty() {
        return Err("session_id 无效".into());
    }
    Ok(archive_dir()?.join(format!("{safe}.json")))
}

fn parse_activity_ms(raw: Option<String>) -> u64 {
    raw.and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(0)
}

fn session_activity_ms(
    archived_at: Option<String>,
    last_message_at_cache: Option<String>,
    updated_at: String,
) -> u64 {
    if archived_at.is_some() {
        return parse_activity_ms(last_message_at_cache).max(parse_activity_ms(Some(updated_at)));
    }
    parse_activity_ms(last_message_at_cache).max(parse_activity_ms(Some(updated_at)))
}

pub fn is_session_archived(conn: &Connection, session_id: &str) -> Result<bool, String> {
    let archived: Option<String> = conn
        .query_row(
            "SELECT archived_at FROM local_sessions WHERE id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(archived
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false))
}

fn load_session_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ArchivedMessageRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, created_at, display_content FROM local_messages WHERE session_id = ?1 ORDER BY CAST(created_at AS INTEGER) ASC, rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![session_id], |r| {
            Ok(ArchivedMessageRow {
                id: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                created_at: r.get(4)?,
                display_content: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn archive_session_messages(conn: &Connection, session_id: &str) -> Result<u64, String> {
    if is_session_archived(conn, session_id)? {
        return Ok(0);
    }
    let messages = load_session_messages(conn, session_id)?;
    if messages.is_empty() {
        return Ok(0);
    }
    let last_message_at = messages
        .last()
        .map(|m| m.created_at.clone())
        .unwrap_or_else(crate::db::now_iso);
    let now = crate::db::now_iso();
    let file = SessionArchiveFile {
        version: 1,
        session_id: session_id.to_string(),
        archived_at: now.clone(),
        messages,
    };
    let path = archive_file_path(session_id)?;
    let json = serde_json::to_string(&file).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入会话归档失败: {e}"))?;
    let n = conn
        .execute(
            "DELETE FROM local_messages WHERE session_id = ?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())? as u64;
    conn.execute(
        "UPDATE local_sessions SET archived_at = ?1, last_message_at_cache = ?2 WHERE id = ?3",
        params![now, last_message_at, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(n)
}

/// 打开会话时自动还原冷存储消息到 SQLite。
pub fn restore_archived_session_if_needed(
    conn: &mut Connection,
    session_id: &str,
) -> Result<bool, String> {
    if !is_session_archived(conn, session_id)? {
        return Ok(false);
    }
    let path = archive_file_path(session_id)?;
    if !path.exists() {
        conn.execute(
            "UPDATE local_sessions SET archived_at = NULL WHERE id = ?1",
            params![session_id],
        )
        .map_err(|e| e.to_string())?;
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取会话归档失败: {e}"))?;
    let file: SessionArchiveFile =
        serde_json::from_str(&raw).map_err(|e| format!("会话归档格式错误: {e}"))?;
    if file.session_id != session_id {
        return Err("会话归档与目标会话不匹配".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM local_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|e| e.to_string())?;
    for m in &file.messages {
        tx.execute(
            "INSERT INTO local_messages (id, session_id, role, content, created_at, display_content) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                m.id,
                m.session_id,
                m.role,
                m.content,
                m.created_at,
                m.display_content
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let last = file
        .messages
        .last()
        .map(|m| m.created_at.as_str())
        .unwrap_or("");
    tx.execute(
        "UPDATE local_sessions SET archived_at = NULL, last_message_at_cache = ?1, updated_at = ?1 WHERE id = ?2",
        params![last, session_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    Ok(true)
}

pub fn remove_archive_file(session_id: &str) {
    if let Ok(path) = archive_file_path(session_id) {
        let _ = std::fs::remove_file(path);
    }
}

/// 带节流：侧栏刷新时最多每 5 分钟执行一次冷存储扫描。
#[allow(dead_code)]
pub fn maybe_apply_session_cold_storage(
    conn: &Connection,
    user_id: &str,
) -> Result<SessionArchiveStats, String> {
    let now_ms = crate::db::now_ms();
    {
        let mut last = LAST_COLD_STORAGE_MS
            .lock()
            .map_err(|_| "冷存储节流锁失败".to_string())?;
        if let Some(prev) = *last {
            if now_ms.saturating_sub(prev) < SESSION_COLD_STORAGE_INTERVAL_MS {
                return Ok(SessionArchiveStats::default());
            }
        }
        *last = Some(now_ms);
    }
    apply_session_cold_storage(conn, user_id)
}

/// 封存超出热保留策略的会话消息（元数据仍留在侧栏列表）。
pub fn apply_session_cold_storage(
    conn: &Connection,
    user_id: &str,
) -> Result<SessionArchiveStats, String> {
    let now_ms = crate::db::now_ms();
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.archived_at, s.last_message_at_cache, s.updated_at,
              (SELECT MAX(m.created_at) FROM local_messages m WHERE m.session_id = s.id) AS live_last
             FROM local_sessions s
             WHERE s.user_id = ?1
             ORDER BY COALESCE(live_last, s.last_message_at_cache, s.updated_at) DESC, s.rowid DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![user_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut sessions = Vec::new();
    for row in rows {
        let (id, archived_at, cache, updated_at, live_last) = row.map_err(|e| e.to_string())?;
        if archived_at.as_deref().map(str::trim).filter(|s| !s.is_empty()).is_some() {
            continue;
        }
        let activity = parse_activity_ms(live_last)
            .max(session_activity_ms(None, cache, updated_at));
        sessions.push((id, activity));
    }

    let mut stats = SessionArchiveStats::default();
    for (rank, (session_id, activity_ms)) in sessions.iter().enumerate() {
        let rank = rank as i64;
        let too_old = *activity_ms > 0 && now_ms.saturating_sub(*activity_ms) > SESSION_ARCHIVE_AGE_MS;
        let beyond_hot = rank >= SESSION_HOT_KEEP;
        if !too_old && !beyond_hot {
            continue;
        }
        let n = archive_session_messages(conn, session_id)?;
        if n > 0 {
            stats.archived_sessions += 1;
            stats.archived_messages += n;
        }
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn open_mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::db::migrate(&c).unwrap();
        crate::db::ensure_local_messages_display_content(&c).unwrap();
        ensure_local_sessions_archive_columns(&c).unwrap();
        c
    }

    #[test]
    fn archives_and_restores_session_messages() {
        let mut conn = open_mem();
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES ('u1', 't', 'h', '1')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO local_sessions (id, title, user_id, created_at, updated_at) VALUES ('s1', 't', 'u1', '100', '100')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO local_messages (id, session_id, role, content, created_at) VALUES ('m1', 's1', 'user', 'hi', '100')",
            [],
        )
        .unwrap();
        let n = archive_session_messages(&conn, "s1").unwrap();
        assert_eq!(n, 1);
        assert!(is_session_archived(&conn, "s1").unwrap());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_messages WHERE session_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert!(restore_archived_session_if_needed(&mut conn, "s1").unwrap());
        let count2: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_messages WHERE session_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count2, 1);
        assert!(!is_session_archived(&conn, "s1").unwrap());
    }
}
