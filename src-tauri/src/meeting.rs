//! 会议助手：流式转写、说话人 A/B/C、按有效字数触发 Agent 阶段整理、导出 Word。

use crate::auth::{assert_authenticated, resolve_authenticated_user};
use crate::chat_files::resolve_output_dir;
use crate::db::{lock_conn, new_id, now_iso, DbState};
use crate::distribution_policy::{
    active_distribution_profile, embedded_relay_api_key, DistributionProfile,
};
use crate::openclaw_env::read_managed_env_map;
use crate::paths;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

const DIGEST_POLL_SECS: u64 = 5;
const DIGEST_CHAR_THRESHOLD: usize = 320;
const DIGEST_MIN_COOLDOWN_SECS: u64 = 45;
const DIGEST_SOFT_MAX_SECS: u64 = 90;
const DIGEST_SOFT_MIN_CHARS: usize = 80;
const DIGEST_BURST_CHARS: usize = 600;
const MAX_SPEAKERS: usize = 3;
const HTTP_TIMEOUT_SECS: u64 = 120;
const ASR_TIMEOUT_SECS: u64 = 300;
const LIVE_WAV_MAX_BYTES: usize = 1_048_576;
const IMPORT_SPEAKER_GAP_MS: i64 = 2500;
const DOCX_TEXT_CHUNK: usize = 4000;
const SEGMENT_TAIL_DEFAULT: i32 = 200;
const ROLLING_SUMMARY_MAX_CHARS: usize = 600;

static LIVE_SKIP_WINDOWS_ASR: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSegmentItem {
    pub id: String,
    pub speaker: String,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDigestItem {
    pub id: String,
    pub period_index: i32,
    pub start_ms: i64,
    pub end_ms: i64,
    pub summary: String,
    pub action_items: Vec<String>,
    pub decisions: Vec<String>,
    pub open_questions: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSessionItem {
    pub id: String,
    pub title: String,
    pub status: String,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub audio_path: Option<String>,
    pub digest_count: i32,
    pub speaker_aliases: HashMap<String, String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingLiveState {
    pub session: MeetingSessionItem,
    pub segments: Vec<MeetingSegmentItem>,
    pub digests: Vec<MeetingDigestItem>,
    pub recording: bool,
    pub elapsed_ms: i64,
    pub segment_total: i32,
    pub has_more_segments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingSegmentsPage {
    pub segments: Vec<MeetingSegmentItem>,
    pub total: i32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDigestEvent {
    pub session_id: String,
    pub digest: MeetingDigestItem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingDigestPendingEvent {
    pub session_id: String,
}

struct DigestWindowPrep {
    last_digest_end: i64,
    digest_count: i32,
    window: Vec<MeetingSegmentItem>,
    prev_summary: String,
    force: bool,
}

struct SpeakerAssigner {
    clusters: Vec<f64>,
    last_end_ms: i64,
    last_idx: usize,
}

impl SpeakerAssigner {
    fn new() -> Self {
        Self {
            clusters: Vec::new(),
            last_end_ms: 0,
            last_idx: 0,
        }
    }

    fn label(idx: usize) -> String {
        match idx {
            0 => "A".to_string(),
            1 => "B".to_string(),
            _ => "C".to_string(),
        }
    }

    fn assign(&mut self, rms: f64, start_ms: i64) -> String {
        let gap = start_ms - self.last_end_ms;
        let rms = rms.clamp(0.0, 1.0);

        if self.clusters.is_empty() {
            self.clusters.push(rms);
            self.last_idx = 0;
            self.last_end_ms = start_ms;
            return Self::label(0);
        }

        let (closest, dist) = self
            .clusters
            .iter()
            .enumerate()
            .map(|(i, c)| (i, (*c - rms).abs()))
            .min_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or((0, 0.0));

        let new_speaker_gap = gap > 1200;
        let distinct_voice = dist > 0.06;

        if (new_speaker_gap && distinct_voice && self.clusters.len() < MAX_SPEAKERS)
            || (distinct_voice && self.clusters.len() < MAX_SPEAKERS && closest == self.last_idx)
        {
            self.clusters.push(rms);
            self.last_idx = self.clusters.len() - 1;
        } else {
            let c = self.clusters[closest];
            let n = self.clusters.len();
            self.clusters[closest] = (c + rms) / 2.0;
            self.last_idx = closest.min(n - 1);
        }

        self.last_end_ms = start_ms;
        Self::label(self.last_idx)
    }
}

struct LiveSessionRuntime {
    user_id: String,
    stop_flag: Arc<AtomicBool>,
    speaker: SpeakerAssigner,
}

pub struct MeetingSupervisor {
    inner: Mutex<HashMap<String, LiveSessionRuntime>>,
    digest_mutexes: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for MeetingSupervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            digest_mutexes: Mutex::new(HashMap::new()),
        }
    }
}

impl MeetingSupervisor {
    fn digest_lock(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut g = self
            .digest_mutexes
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        g.entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn is_live(&self, session_id: &str) -> bool {
        self.inner
            .lock()
            .map(|g| g.contains_key(session_id))
            .unwrap_or(false)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn meeting_root(session_id: &str) -> Result<std::path::PathBuf, String> {
    let dir = paths::installed_dir()?
        .join("workspace")
        .join("meetings")
        .join(session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn require_session_owner(conn: &rusqlite::Connection, session_id: &str, user_id: &str) -> Result<(), String> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT user_id FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "会议不存在".to_string())?;
    if owner.as_deref() != Some(user_id) {
        return Err("无权访问该会议".to_string());
    }
    Ok(())
}

fn reconcile_orphan_recording(
    conn: &rusqlite::Connection,
    session_id: &str,
    supervisor: &MeetingSupervisor,
) -> Result<(), String> {
    let status: String = conn
        .query_row(
            "SELECT status FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "会议不存在".to_string())?;
    if status == "recording" && !supervisor.is_live(session_id) {
        let now = now_iso();
        conn.execute(
            "UPDATE meeting_sessions SET status = 'interrupted', updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn reconcile_user_orphan_recordings(
    conn: &rusqlite::Connection,
    user_id: &str,
    supervisor: &MeetingSupervisor,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id FROM meeting_sessions WHERE user_id = ?1 AND status = 'recording'")
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map(rusqlite::params![user_id], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    for id in ids {
        reconcile_orphan_recording(conn, &id, supervisor)?;
    }
    Ok(())
}

fn parse_speaker_aliases(raw: Option<String>) -> HashMap<String, String> {
    match raw {
        None => HashMap::new(),
        Some(s) if s.trim().is_empty() => HashMap::new(),
        Some(s) => serde_json::from_str::<HashMap<String, String>>(&s).unwrap_or_default(),
    }
}

fn speaker_display_label(aliases: &HashMap<String, String>, speaker: &str) -> String {
    aliases
        .get(speaker)
        .filter(|v| !v.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| speaker.to_string())
}

const SESSION_SELECT: &str = "id, title, status, started_at_ms, ended_at_ms, audio_path, digest_count, created_at, updated_at, speaker_aliases_json";

fn map_session_row(r: &rusqlite::Row<'_>) -> Result<MeetingSessionItem, rusqlite::Error> {
    Ok(MeetingSessionItem {
        id: r.get(0)?,
        title: r.get(1)?,
        status: r.get(2)?,
        started_at_ms: r.get(3)?,
        ended_at_ms: r.get(4)?,
        audio_path: r.get(5)?,
        digest_count: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        speaker_aliases: parse_speaker_aliases(r.get(9)?),
    })
}

fn load_session_row(conn: &rusqlite::Connection, session_id: &str) -> Result<MeetingSessionItem, String> {
    let sql = format!("SELECT {SESSION_SELECT} FROM meeting_sessions WHERE id = ?1");
    conn.query_row(&sql, rusqlite::params![session_id], map_session_row)
        .map_err(|_| "会议不存在".to_string())
}

fn load_segments(conn: &rusqlite::Connection, session_id: &str) -> Result<Vec<MeetingSegmentItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, speaker, text, start_ms, end_ms FROM meeting_segments
             WHERE session_id = ?1 ORDER BY start_ms ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |r| {
            Ok(MeetingSegmentItem {
                id: r.get(0)?,
                speaker: r.get(1)?,
                text: r.get(2)?,
                start_ms: r.get(3)?,
                end_ms: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn count_segments(conn: &rusqlite::Connection, session_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM meeting_segments WHERE session_id = ?1",
        rusqlite::params![session_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

fn load_segments_tail(
    conn: &rusqlite::Connection,
    session_id: &str,
    tail: i64,
) -> Result<Vec<MeetingSegmentItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, speaker, text, start_ms, end_ms FROM meeting_segments
             WHERE session_id = ?1 ORDER BY start_ms DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id, tail], |r| {
            Ok(MeetingSegmentItem {
                id: r.get(0)?,
                speaker: r.get(1)?,
                text: r.get(2)?,
                start_ms: r.get(3)?,
                end_ms: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

fn load_segments_before(
    conn: &rusqlite::Connection,
    session_id: &str,
    before_start_ms: i64,
    limit: i64,
) -> Result<Vec<MeetingSegmentItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, speaker, text, start_ms, end_ms FROM meeting_segments
             WHERE session_id = ?1 AND start_ms < ?2 ORDER BY start_ms DESC LIMIT ?3",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id, before_start_ms, limit], |r| {
            Ok(MeetingSegmentItem {
                id: r.get(0)?,
                speaker: r.get(1)?,
                text: r.get(2)?,
                start_ms: r.get(3)?,
                end_ms: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

fn parse_json_strings(raw: Option<String>) -> Vec<String> {
    match raw {
        None => Vec::new(),
        Some(s) if s.trim().is_empty() => Vec::new(),
        Some(s) => serde_json::from_str::<Vec<String>>(&s).unwrap_or_default(),
    }
}

fn load_digests(conn: &rusqlite::Connection, session_id: &str) -> Result<Vec<MeetingDigestItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, period_index, start_ms, end_ms, summary, action_items_json, decisions_json, open_questions_json, created_at
             FROM meeting_digests WHERE session_id = ?1 ORDER BY period_index ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |r| {
            Ok(MeetingDigestItem {
                id: r.get(0)?,
                period_index: r.get(1)?,
                start_ms: r.get(2)?,
                end_ms: r.get(3)?,
                summary: r.get(4)?,
                action_items: parse_json_strings(r.get(5)?),
                decisions: parse_json_strings(r.get(6)?),
                open_questions: parse_json_strings(r.get(7)?),
                created_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn build_live_state(
    conn: &rusqlite::Connection,
    session_id: &str,
    recording: bool,
    segment_tail: Option<i32>,
) -> Result<MeetingLiveState, String> {
    let session = load_session_row(conn, session_id)?;
    let total = count_segments(conn, session_id)? as i32;
    let tail = segment_tail.unwrap_or(SEGMENT_TAIL_DEFAULT).max(1);
    let segments = if total > tail {
        load_segments_tail(conn, session_id, tail as i64)?
    } else {
        load_segments(conn, session_id)?
    };
    let has_more_segments = (segments.len() as i32) < total;
    let digests = load_digests(conn, session_id)?;
    let elapsed_ms = if recording {
        now_ms().saturating_sub(session.started_at_ms.max(0))
    } else if let Some(ended) = session.ended_at_ms {
        ended.saturating_sub(session.started_at_ms.max(0))
    } else {
        0
    };
    Ok(MeetingLiveState {
        session,
        segments,
        digests,
        recording,
        elapsed_ms,
        segment_total: total,
        has_more_segments,
    })
}

fn format_segments_for_digest(segments: &[MeetingSegmentItem]) -> String {
    segments
        .iter()
        .map(|s| format!("[{}–{}ms] {}: {}", s.start_ms, s.end_ms, s.speaker, s.text))
        .collect::<Vec<_>>()
        .join("\n")
}

fn window_char_count(segments: &[MeetingSegmentItem]) -> usize {
    segments.iter().map(|s| s.text.chars().count()).sum()
}

fn format_elapsed_label(ms: i64) -> String {
    let total = (ms / 1000).max(0);
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn segment_overlaps_digest(seg: &MeetingSegmentItem, digest: &MeetingDigestItem) -> bool {
    seg.start_ms <= digest.end_ms && seg.end_ms >= digest.start_ms
}

fn digest_relates_to_speaker(
    digest: &MeetingDigestItem,
    speaker: &str,
    segments: &[MeetingSegmentItem],
) -> bool {
    segments.iter().any(|s| {
        s.speaker.eq_ignore_ascii_case(speaker) && segment_overlaps_digest(s, digest)
    })
}

#[derive(Debug, Deserialize)]
struct DigestLlmJson {
    #[serde(default)]
    summary: String,
    #[serde(default, alias = "actionItems")]
    action_items: Vec<String>,
    #[serde(default)]
    decisions: Vec<String>,
    #[serde(default, alias = "openQuestions")]
    open_questions: Vec<String>,
}

fn nonempty_env(map: &HashMap<String, String>, key: &str) -> Option<String> {
    map.get(key)
        .filter(|s| !s.trim().is_empty())
        .map(String::from)
}

fn resolve_llm_credentials() -> Result<(String, String, String), String> {
    let profile = active_distribution_profile();
    let map = read_managed_env_map()?;

    match profile {
        DistributionProfile::Internal => {
            let full = crate::distribution_policy::preferred_primary_model_for_env_keys(&map)
                .unwrap_or_else(|| profile.primary_model().to_string());
            let provider = full.split('/').next().unwrap_or("deepseek");
            let short = full.rsplit('/').next().unwrap_or("deepseek-flash");
            match provider {
                "mimo" => {
                    if let Some(api_key) = nonempty_env(&map, "MIMO_API_KEY") {
                        return Ok((
                            "https://api.xiaomimimo.com/v1/chat/completions".to_string(),
                            api_key,
                            short.to_string(),
                        ));
                    }
                }
                "qwen" => {
                    if let Some(api_key) = nonempty_env(&map, "DASHSCOPE_API_KEY") {
                        return Ok((
                            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
                                .to_string(),
                            api_key,
                            short.to_string(),
                        ));
                    }
                }
                _ => {
                    if let Some(api_key) = nonempty_env(&map, "DEEPSEEK_API_KEY") {
                        return Ok((
                            "https://api.deepseek.com/v1/chat/completions".to_string(),
                            api_key,
                            short.to_string(),
                        ));
                    }
                }
            }
            // 首选厂商 Key 缺失时，按任意已配置厂商回退。
            if let Some(api_key) = nonempty_env(&map, "DEEPSEEK_API_KEY") {
                return Ok((
                    "https://api.deepseek.com/v1/chat/completions".to_string(),
                    api_key,
                    "deepseek-flash".to_string(),
                ));
            }
            if let Some(api_key) = nonempty_env(&map, "MIMO_API_KEY") {
                return Ok((
                    "https://api.xiaomimimo.com/v1/chat/completions".to_string(),
                    api_key,
                    "mimo-v2.5".to_string(),
                ));
            }
            if let Some(api_key) = nonempty_env(&map, "DASHSCOPE_API_KEY") {
                return Ok((
                    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions".to_string(),
                    api_key,
                    "qwen3.6-flash".to_string(),
                ));
            }
            Err("请至少配置一家模型厂商 API Key（MiMo / DeepSeek / 千问），无法整理会议纪要".into())
        }
        DistributionProfile::RelayStation => {
            let env_key = profile.primary_api_env_key();
            let api_key = map
                .get(env_key)
                .filter(|s| !s.trim().is_empty())
                .map(String::from)
                .or_else(|| embedded_relay_api_key().map(|s| s.to_string()))
                .ok_or_else(|| format!("未配置 {}，无法整理会议纪要", env_key))?;
            Ok((
                "https://api.doohuan.com/v1/chat/completions".to_string(),
                api_key,
                profile.primary_model().to_string(),
            ))
        }
    }
}

fn call_digest_llm(
    transcript: &str,
    period_label: &str,
    rolling_context: &str,
) -> Result<DigestLlmJson, String> {
    let (url, api_key, model) = resolve_llm_credentials()?;
    let system = "你是会议助手。根据带说话人标记（A/B/C）的会议转写，输出严格 JSON，不要 markdown 代码块。字段：summary(字符串)、actionItems(字符串数组)、decisions(字符串数组)、openQuestions(字符串数组)。用中文。只提炼本阶段新增内容，不要重复已知结论。";
    let ctx = if rolling_context.trim().is_empty() {
        String::new()
    } else {
        let short: String = rolling_context.chars().take(ROLLING_SUMMARY_MAX_CHARS).collect();
        format!("【此前滚动摘要】\n{short}\n\n")
    };
    let user = format!(
        "{ctx}以下是会议第 {period_label} 阶段的新增转写：\n\n{transcript}\n\n请提炼本阶段摘要、决议、待办与未决问题。"
    );
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "max_tokens": 1200,
        "temperature": 0.2,
        "response_format": { "type": "json_object" }
    });
    let body_str = serde_json::to_string(&body).map_err(|e| format!("序列化请求失败: {e}"))?;
    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Content-Type", "application/json")
        .send_string(&body_str)
        .map_err(|e| format!("会议纪要请求失败: {e}"))?;
    let status = resp.status();
    let raw = resp.into_string().map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(format!("会议纪要 API 错误 ({status}): {raw}"));
    }
    let parsed: Value = serde_json::from_str(&raw).map_err(|e| format!("解析响应失败: {e}"))?;
    let content = parsed
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .trim();
    if content.is_empty() {
        return Err("会议纪要 API 返回空内容".to_string());
    }
    let digest: DigestLlmJson =
        serde_json::from_str(content).map_err(|e| format!("解析纪要 JSON 失败: {e} — {content}"))?;
    Ok(digest)
}

fn should_trigger_digest(new_chars: usize, wall_elapsed_ms: i64, force: bool) -> bool {
    if force {
        return new_chars > 0;
    }
    if new_chars == 0 {
        return false;
    }
    let wall_secs = wall_elapsed_ms / 1000;
    if wall_secs < DIGEST_MIN_COOLDOWN_SECS as i64 {
        return false;
    }
    if new_chars >= DIGEST_BURST_CHARS {
        return true;
    }
    if new_chars >= DIGEST_CHAR_THRESHOLD {
        return true;
    }
    if wall_secs >= DIGEST_SOFT_MAX_SECS as i64 && new_chars >= DIGEST_SOFT_MIN_CHARS {
        return true;
    }
    false
}

fn prepare_digest_window(
    conn: &rusqlite::Connection,
    session_id: &str,
    force: bool,
) -> Result<Option<DigestWindowPrep>, String> {
    let last_digest_end: i64 = conn
        .query_row(
            "SELECT last_digest_end_ms FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "会议不存在".to_string())?;

    let last_digest_wall: i64 = conn
        .query_row(
            "SELECT last_digest_wall_ms FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .unwrap_or(0);

    let started_at: i64 = conn
        .query_row(
            "SELECT started_at_ms FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "会议不存在".to_string())?;

    let digest_count: i32 = conn
        .query_row(
            "SELECT digest_count FROM meeting_sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .map_err(|_| "会议不存在".to_string())?;

    let segments = load_segments(conn, session_id)?;
    let window: Vec<MeetingSegmentItem> = segments
        .iter()
        .filter(|s| s.start_ms >= last_digest_end && !s.text.trim().is_empty())
        .cloned()
        .collect();

    if window.is_empty() {
        return Ok(None);
    }

    let total_chars = window_char_count(&window);
    let wall_base = if last_digest_wall > 0 {
        last_digest_wall
    } else {
        started_at.max(0)
    };
    let wall_elapsed = now_ms().saturating_sub(wall_base);

    if !should_trigger_digest(total_chars, wall_elapsed, force) {
        return Ok(None);
    }

    let prev_summary = load_digests(conn, session_id)?
        .last()
        .map(|d| d.summary.clone())
        .unwrap_or_default();

    Ok(Some(DigestWindowPrep {
        last_digest_end,
        digest_count,
        window,
        prev_summary,
        force,
    }))
}

fn fallback_digest_from_transcript(transcript: &str, err: &str) -> DigestLlmJson {
    DigestLlmJson {
        summary: format!(
            "（自动整理暂不可用：{err}）\n\n{}",
            transcript.chars().take(800).collect::<String>()
        ),
        action_items: Vec::new(),
        decisions: Vec::new(),
        open_questions: Vec::new(),
    }
}

fn persist_digest(
    conn: &rusqlite::Connection,
    session_id: &str,
    digest_count: i32,
    start_ms: i64,
    end_ms: i64,
    digest_json: &DigestLlmJson,
) -> Result<MeetingDigestItem, String> {
    let digest_id = new_id();
    let created = now_iso();
    let wall_now = now_ms();
    let action_json =
        serde_json::to_string(&digest_json.action_items).unwrap_or_else(|_| "[]".to_string());
    let decisions_json =
        serde_json::to_string(&digest_json.decisions).unwrap_or_else(|_| "[]".to_string());
    let open_json =
        serde_json::to_string(&digest_json.open_questions).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO meeting_digests (id, session_id, period_index, start_ms, end_ms, summary, action_items_json, decisions_json, open_questions_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            digest_id,
            session_id,
            digest_count,
            start_ms,
            end_ms,
            digest_json.summary,
            action_json,
            decisions_json,
            open_json,
            created,
        ],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE meeting_sessions SET last_digest_end_ms = ?1, last_digest_wall_ms = ?2, digest_count = digest_count + 1, updated_at = ?3 WHERE id = ?4",
        rusqlite::params![end_ms, wall_now, created, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(MeetingDigestItem {
        id: digest_id,
        period_index: digest_count,
        start_ms,
        end_ms,
        summary: digest_json.summary.clone(),
        action_items: digest_json.action_items.clone(),
        decisions: digest_json.decisions.clone(),
        open_questions: digest_json.open_questions.clone(),
        created_at: created,
    })
}

fn run_period_digest(app: &AppHandle, session_id: &str, force: bool) -> Result<Option<MeetingDigestItem>, String> {
    let supervisor = app.state::<MeetingSupervisor>();
    let digest_guard = supervisor.digest_lock(session_id);
    let _session_digest = digest_guard
        .lock()
        .map_err(|e| format!("阶段整理锁异常: {e}"))?;

    let prep = {
        let db_state = app.state::<DbState>();
        let conn = lock_conn(&db_state.conn);
        prepare_digest_window(&conn, session_id, force)?
    };

    let Some(prep) = prep else {
        return Ok(None);
    };

    let _ = app.emit(
        "meeting-digest-pending",
        MeetingDigestPendingEvent {
            session_id: session_id.to_string(),
        },
    );

    let start_ms = prep
        .window
        .first()
        .map(|s| s.start_ms)
        .unwrap_or(prep.last_digest_end);
    let end_ms = prep
        .window
        .last()
        .map(|s| s.end_ms)
        .unwrap_or(start_ms);
    let transcript = format_segments_for_digest(&prep.window);
    let period_label = format!("{}", prep.digest_count + 1);

    let digest_json = match call_digest_llm(&transcript, &period_label, &prep.prev_summary) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[YunTuAI meeting] digest LLM failed: {e}");
            if prep.force {
                fallback_digest_from_transcript(&transcript, &e)
            } else {
                return Ok(None);
            }
        }
    };

    let item = {
        let db_state = app.state::<DbState>();
        let conn = lock_conn(&db_state.conn);
        persist_digest(
            &conn,
            session_id,
            prep.digest_count,
            start_ms,
            end_ms,
            &digest_json,
        )?
    };

    let _ = app.emit(
        "meeting-digest-update",
        MeetingDigestEvent {
            session_id: session_id.to_string(),
            digest: item.clone(),
        },
    );

    Ok(Some(item))
}

fn spawn_digest_loop(app: AppHandle, session_id: String, stop_flag: Arc<AtomicBool>) {
    thread::Builder::new()
        .name(format!("yuntuai-meeting-digest-{session_id}"))
        .spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                for _ in 0..DIGEST_POLL_SECS {
                    if stop_flag.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }
                if let Err(e) = run_period_digest(&app, &session_id, false) {
                    eprintln!("[YunTuAI meeting] periodic digest: {e}");
                }
            }
        })
        .ok();
}

fn sanitize_docx_text(s: &str) -> String {
    s.chars()
        .filter(|c| {
            *c == '\t'
                || *c == '\n'
                || *c == '\r'
                || (*c >= ' ' && *c != '\u{FFFE}' && *c != '\u{FFFF}')
        })
        .collect()
}

fn xml_escape(s: &str) -> String {
    sanitize_docx_text(s)
        .chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

fn docx_paragraph(text: &str, bold: bool) -> String {
    let escaped = xml_escape(text);
    if bold {
        format!(
            r#"<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>"#
        )
    } else {
        format!(
            r#"<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">{escaped}</w:t></w:r></w:p>"#
        )
    }
}

fn docx_paragraphs_from_text(text: &str, bold: bool) -> Vec<String> {
    let sanitized = sanitize_docx_text(text);
    if sanitized.trim().is_empty() {
        return vec![docx_paragraph("", bold)];
    }
    let chars: Vec<char> = sanitized.chars().collect();
    chars
        .chunks(DOCX_TEXT_CHUNK)
        .map(|chunk| docx_paragraph(&chunk.iter().collect::<String>(), bold))
        .collect()
}

fn sanitize_export_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric()
                || "._-()（）".contains(c)
                || ('\u{4e00}'..='\u{9fff}').contains(&c)
            {
                c
            } else {
                '_'
            }
        })
        .collect();
    let t = cleaned.trim_matches('_').trim();
    if t.is_empty() {
        "会议纪要".to_string()
    } else {
        t.chars().take(80).collect()
    }
}

fn write_meeting_docx(path: &std::path::Path, paragraphs: &[String]) -> Result<(), String> {
    let body = paragraphs.join("");
    let document_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>"#
    );
    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>"#;

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buffer);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("[Content_Types].xml", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(content_types.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.start_file("_rels/.rels", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(rels.as_bytes()).map_err(|e| e.to_string())?;
        zip.start_file("word/document.xml", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(document_xml.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.start_file("word/_rels/document.xml.rels", opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(doc_rels.as_bytes())
            .map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = File::create(path).map_err(|e| format!("创建 Word 失败: {e}"))?;
    file.write_all(buffer.get_ref())
        .map_err(|e| format!("写入 Word 失败: {e}"))?;
    Ok(())
}

fn dedupe_strings(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let key = item.trim();
        if key.is_empty() || seen.contains(key) {
            continue;
        }
        seen.insert(key.to_string());
        out.push(item);
    }
    out
}

fn build_export_paragraphs(
    session: &MeetingSessionItem,
    digests: &[MeetingDigestItem],
    segments: &[MeetingSegmentItem],
    speaker_filter: Option<&str>,
    all_segments: &[MeetingSegmentItem],
) -> Vec<String> {
    let mut paras = Vec::new();
    let aliases = &session.speaker_aliases;
    let title = match speaker_filter {
        Some(sp) => {
            let label = speaker_display_label(aliases, sp);
            format!("{} · 发言人{} ({label})", session.title, sp)
        }
        None => format!("{} · 会议纪要", session.title),
    };
    paras.extend(docx_paragraphs_from_text(&title, true));
    paras.extend(docx_paragraphs_from_text(
        &format!(
            "状态：{} · 阶段整理 {} 次 · 转写段落 {} 条",
            match session.status.as_str() {
                "recording" => "录制中",
                "interrupted" => "意外中断",
                _ => "已结束",
            },
            digests.len(),
            segments.len()
        ),
        false,
    ));
    paras.extend(docx_paragraphs_from_text("", false));

    let export_digests: Vec<&MeetingDigestItem> = if let Some(sp) = speaker_filter {
        digests
            .iter()
            .filter(|d| digest_relates_to_speaker(d, sp, all_segments))
            .collect()
    } else {
        digests.iter().collect()
    };

    if speaker_filter.is_none() && !digests.is_empty() {
        let all_decisions: Vec<String> = dedupe_strings(
            digests
                .iter()
                .flat_map(|d| d.decisions.clone())
                .collect(),
        );
        let all_actions: Vec<String> = dedupe_strings(
            digests
                .iter()
                .flat_map(|d| d.action_items.clone())
                .collect(),
        );
        let all_open: Vec<String> = dedupe_strings(
            digests
                .iter()
                .flat_map(|d| d.open_questions.clone())
                .collect(),
        );
        if !all_decisions.is_empty() || !all_actions.is_empty() || !all_open.is_empty() {
            paras.extend(docx_paragraphs_from_text("综合纪要", true));
            for item in &all_decisions {
                paras.extend(docx_paragraphs_from_text(&format!("决议：{item}"), false));
            }
            for item in &all_actions {
                paras.extend(docx_paragraphs_from_text(&format!("待办：{item}"), false));
            }
            for item in &all_open {
                paras.extend(docx_paragraphs_from_text(&format!("未决：{item}"), false));
            }
            paras.extend(docx_paragraphs_from_text("", false));
        }
    }

    if !export_digests.is_empty() {
        let heading = if speaker_filter.is_some() {
            "相关阶段整理"
        } else {
            "一、阶段整理"
        };
        paras.extend(docx_paragraphs_from_text(heading, true));
        for d in export_digests {
            paras.extend(docx_paragraphs_from_text(
                &format!(
                    "阶段 {}（{} – {}）",
                    d.period_index + 1,
                    format_elapsed_label(d.start_ms),
                    format_elapsed_label(d.end_ms)
                ),
                true,
            ));
            if !d.summary.trim().is_empty() {
                paras.extend(docx_paragraphs_from_text(&d.summary, false));
            }
            for item in &d.decisions {
                paras.extend(docx_paragraphs_from_text(&format!("决议：{item}"), false));
            }
            for item in &d.action_items {
                paras.extend(docx_paragraphs_from_text(&format!("待办：{item}"), false));
            }
            for item in &d.open_questions {
                paras.extend(docx_paragraphs_from_text(&format!("未决：{item}"), false));
            }
            paras.extend(docx_paragraphs_from_text("", false));
        }
    }

    let heading = if speaker_filter.is_some() {
        "逐字稿（按发言人）"
    } else {
        "二、全文转写（A / B / C）"
    };
    paras.extend(docx_paragraphs_from_text(heading, true));
    if segments.is_empty() {
        paras.extend(docx_paragraphs_from_text("（无转写内容）", false));
    } else {
        for seg in segments {
            let label = speaker_display_label(aliases, &seg.speaker);
            let speaker_part = if label == seg.speaker {
                label
            } else {
                format!("{label} ({})", seg.speaker)
            };
            paras.extend(docx_paragraphs_from_text(
                &format!(
                    "[{}] {}: {}",
                    format_elapsed_label(seg.start_ms),
                    speaker_part,
                    seg.text
                ),
                false,
            ));
        }
    }
    paras
}

#[tauri::command]
pub fn meeting_create_session(
    state: State<'_, DbState>,
    token: String,
    title: Option<String>,
) -> Result<MeetingSessionItem, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    let id = new_id();
    let now = now_iso();
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| format!("会议 {}", chrono::Local::now().format("%m-%d %H:%M")));

    meeting_root(&id)?;

    conn.execute(
        "INSERT INTO meeting_sessions (id, user_id, title, status, started_at_ms, last_digest_end_ms, digest_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'ready', 0, 0, 0, ?4, ?4)",
        rusqlite::params![id, user_id, title, now],
    )
    .map_err(|e| e.to_string())?;

    load_session_row(&conn, &id)
}

#[tauri::command]
pub fn meeting_list_sessions(
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
) -> Result<Vec<MeetingSessionItem>, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    reconcile_user_orphan_recordings(&conn, &user_id, &supervisor)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SESSION_SELECT} FROM meeting_sessions WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 80"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![user_id], map_session_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn meeting_get_live_state(
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
    segment_tail: Option<i32>,
) -> Result<MeetingLiveState, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;
    reconcile_orphan_recording(&conn, &session_id, &supervisor)?;
    let recording = supervisor.is_live(&session_id);
    build_live_state(&conn, &session_id, recording, segment_tail)
}

#[tauri::command]
pub fn meeting_start_recording(
    app: AppHandle,
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
) -> Result<MeetingLiveState, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;

    let now = now_iso();
    let started = now_ms();
    conn.execute(
        "UPDATE meeting_sessions SET status = 'recording', started_at_ms = ?1, ended_at_ms = NULL, last_digest_end_ms = 0, last_digest_wall_ms = ?1, digest_count = 0, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![started, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM meeting_segments WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM meeting_digests WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    let audio_path = meeting_root(&session_id)?.join("recording.webm");
    if audio_path.exists() {
        let _ = fs::remove_file(&audio_path);
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    spawn_digest_loop(app.clone(), session_id.clone(), Arc::clone(&stop_flag));

    let runtime = LiveSessionRuntime {
        user_id,
        stop_flag,
        speaker: SpeakerAssigner::new(),
    };

    if let Ok(mut g) = supervisor.inner.lock() {
        if let Some(old) = g.remove(&session_id) {
            old.stop_flag.store(true, Ordering::Relaxed);
        }
        g.insert(session_id.clone(), runtime);
    }

    build_live_state(&conn, &session_id, true, None)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn meeting_push_segment(
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
    text: String,
    start_ms: i64,
    end_ms: i64,
    rms: Option<f64>,
) -> Result<MeetingSegmentItem, String> {
    assert_authenticated(&state, &token)?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("转写内容为空".to_string());
    }
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;

    let speaker = {
        let mut g = supervisor.inner.lock().map_err(|e| e.to_string())?;
        let runtime = g
            .get_mut(&session_id)
            .ok_or_else(|| "会议未在录制中".to_string())?;
        if runtime.user_id != user_id {
            return Err("无权操作该会议".to_string());
        }
        let rms_val = rms.unwrap_or(0.12);
        runtime.speaker.assign(rms_val, start_ms)
    };

    let id = new_id();
    let now = now_iso();
    conn.execute(
        "INSERT INTO meeting_segments (id, session_id, speaker, text, start_ms, end_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, session_id, speaker, trimmed, start_ms, end_ms, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE meeting_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(MeetingSegmentItem {
        id,
        speaker,
        text: trimmed.to_string(),
        start_ms,
        end_ms,
    })
}

#[tauri::command]
pub async fn meeting_push_audio_chunk(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    chunk_base64: String,
) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;
    }

    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        chunk_base64.trim(),
    )
    .map_err(|e| format!("音频块解码失败: {e}"))?;

    let audio_path = meeting_root(&session_id)?.join("recording.webm");
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&audio_path)
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    let path_str = audio_path.to_string_lossy().to_string();
    let now = now_iso();
    let conn = lock_conn(&state.conn);
    conn.execute(
        "UPDATE meeting_sessions SET audio_path = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![path_str, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn meeting_transcribe_live_chunk(
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
    wav_base64: String,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;
        let g = supervisor.inner.lock().map_err(|e| e.to_string())?;
        let runtime = g
            .get(&session_id)
            .ok_or_else(|| "会议未在录制中".to_string())?;
        if runtime.user_id != user_id {
            return Err("无权操作该会议".to_string());
        }
    }

    let bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        wav_base64.trim(),
    )
    .map_err(|e| format!("音频块解码失败: {e}"))?;
    crate::ipc::run_blocking(move || transcribe_live_wav_bytes(&bytes)).await
}

#[tauri::command]
pub async fn meeting_stop_recording(
    app: AppHandle,
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
) -> Result<MeetingLiveState, String> {
    assert_authenticated(&state, &token)?;
    {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;
        if let Ok(mut g) = supervisor.inner.lock() {
            if let Some(runtime) = g.remove(&session_id) {
                runtime.stop_flag.store(true, Ordering::Relaxed);
            }
        }
        let ended = now_ms();
        let now = now_iso();
        conn.execute(
            "UPDATE meeting_sessions SET status = 'ready', ended_at_ms = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![ended, now, session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let app_for_digest = app.clone();
    let session_for_digest = session_id.clone();
    if let Err(e) = crate::ipc::run_blocking(move || {
        run_period_digest(&app_for_digest, &session_for_digest, true)
    })
    .await
    {
        eprintln!("[YunTuAI meeting] final digest: {e}");
    }

    let conn = lock_conn(&state.conn);
    build_live_state(&conn, &session_id, false, None)
}

#[tauri::command]
pub fn meeting_load_older_segments(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    before_start_ms: i64,
    limit: Option<i32>,
) -> Result<MeetingSegmentsPage, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;
    let limit = limit.unwrap_or(SEGMENT_TAIL_DEFAULT).max(1) as i64;
    let total = count_segments(&conn, &session_id)? as i32;
    let segments = load_segments_before(&conn, &session_id, before_start_ms, limit)?;
    let oldest = segments.first().map(|s| s.start_ms).unwrap_or(0);
    let has_more = segments
        .first()
        .map(|_| {
            conn.query_row(
                "SELECT COUNT(*) FROM meeting_segments WHERE session_id = ?1 AND start_ms < ?2",
                rusqlite::params![session_id, oldest],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(0)
                > 0
        })
        .unwrap_or(false);
    Ok(MeetingSegmentsPage {
        segments,
        total,
        has_more,
    })
}

#[tauri::command]
pub async fn meeting_trigger_digest(
    app: AppHandle,
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
) -> Result<MeetingLiveState, String> {
    assert_authenticated(&state, &token)?;
    let recording = {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;
        supervisor.is_live(&session_id)
    };

    let app_for_digest = app.clone();
    let session_for_digest = session_id.clone();
    crate::ipc::run_blocking(move || {
        run_period_digest(&app_for_digest, &session_for_digest, true).map(|_| ())
    })
    .await?;

    let conn = lock_conn(&state.conn);
    build_live_state(&conn, &session_id, recording, None)
}

#[tauri::command]
pub fn meeting_update_session(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    title: Option<String>,
    speaker_aliases: Option<HashMap<String, String>>,
) -> Result<MeetingSessionItem, String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;

    if let Some(t) = title {
        let trimmed = t.trim();
        if !trimmed.is_empty() {
            conn.execute(
                "UPDATE meeting_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![trimmed, now_iso(), session_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    if let Some(aliases) = speaker_aliases {
        let mut cleaned = HashMap::new();
        for (k, v) in aliases {
            let key = k.trim().to_uppercase();
            if !matches!(key.as_str(), "A" | "B" | "C") {
                continue;
            }
            let val = v.trim();
            if !val.is_empty() {
                cleaned.insert(key, val.to_string());
            }
        }
        let json = serde_json::to_string(&cleaned).unwrap_or_else(|_| "{}".to_string());
        conn.execute(
            "UPDATE meeting_sessions SET speaker_aliases_json = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![json, now_iso(), session_id],
        )
        .map_err(|e| e.to_string())?;
    }

    load_session_row(&conn, &session_id)
}

#[tauri::command]
pub fn meeting_update_segment(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    segment_id: String,
    text: String,
) -> Result<MeetingSegmentItem, String> {
    assert_authenticated(&state, &token)?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("转写内容不能为空".to_string());
    }
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;

    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM meeting_segments WHERE id = ?1 AND session_id = ?2",
            rusqlite::params![segment_id, session_id],
            |r| r.get(0),
        )
        .ok();
    if exists.is_none() {
        return Err("转写段落不存在".to_string());
    }

    let now = now_iso();
    conn.execute(
        "UPDATE meeting_segments SET text = ?1 WHERE id = ?2 AND session_id = ?3",
        rusqlite::params![trimmed, segment_id, session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE meeting_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, speaker, text, start_ms, end_ms FROM meeting_segments WHERE id = ?1",
        rusqlite::params![segment_id],
        |r| {
            Ok(MeetingSegmentItem {
                id: r.get(0)?,
                speaker: r.get(1)?,
                text: r.get(2)?,
                start_ms: r.get(3)?,
                end_ms: r.get(4)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn meeting_import_audio(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
    session_id: String,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;
    }

    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let picked = rfd::FileDialog::new()
            .add_filter("音频", &["mp3", "wav", "m4a", "webm", "ogg", "flac", "aac"])
            .pick_file();
        let _ = tx.send(picked);
    })
    .map_err(|e| format!("无法打开文件对话框: {e}"))?;
    let picked = rx
        .recv()
        .map_err(|_| "文件对话框已关闭".to_string())?
        .ok_or_else(|| "未选择文件".to_string())?;

    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("audio")
        .to_lowercase();
    let dest = meeting_root(&session_id)?.join(format!("imported.{ext}"));
    fs::copy(&picked, &dest).map_err(|e| format!("复制音频失败: {e}"))?;

    let path_str = dest.to_string_lossy().to_string();
    let now = now_iso();
    let conn = lock_conn(&state.conn);
    conn.execute(
        "UPDATE meeting_sessions SET audio_path = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![path_str, now, session_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(path_str)
}

#[derive(Debug, Clone, Deserialize)]
struct WhisperSegment {
    start: f64,
    end: f64,
    text: String,
}

#[derive(Debug, Deserialize)]
struct WhisperVerboseResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    segments: Vec<WhisperSegment>,
}

fn resolve_asr_credentials() -> Result<(String, String), String> {
    let profile = active_distribution_profile();
    let map = read_managed_env_map()?;

    if profile == DistributionProfile::RelayStation {
        let env_key = profile.primary_api_env_key();
        let api_key = map
            .get(env_key)
            .filter(|s| !s.trim().is_empty())
            .map(String::from)
            .or_else(|| embedded_relay_api_key().map(|s| s.to_string()))
            .ok_or_else(|| {
                format!(
                    "未配置 {}，无法转写音频。请先在设置中填写 API Key，或使用实时录制转写。",
                    env_key
                )
            })?;
        return Ok(("https://api.doohuan.com/v1".to_string(), api_key));
    }

    if let Some(key) = map.get("DEEPSEEK_API_KEY").filter(|s| !s.trim().is_empty()) {
        return Ok(("https://api.deepseek.com/v1".to_string(), key.clone()));
    }
    if let Some(key) = map.get("DASHSCOPE_API_KEY").filter(|s| !s.trim().is_empty()) {
        return Ok((
            "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            key.clone(),
        ));
    }
    Err(
        "未配置 DEEPSEEK_API_KEY 或 DASHSCOPE_API_KEY，无法转写音频。会议 Whisper 暂不支持 MiMo Key；请填写 DeepSeek 或千问 Key，或使用实时录制转写。"
            .to_string(),
    )
}

fn asr_endpoint_candidates() -> Result<Vec<(String, String)>, String> {
    let map = read_managed_env_map()?;
    let profile = active_distribution_profile();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |base: &str, key: &str| {
        let k = key.trim();
        if k.is_empty() {
            return;
        }
        let pair = (base.trim_end_matches('/').to_string(), k.to_string());
        if !out.iter().any(|(b, kk)| b == &pair.0 && kk == &pair.1) {
            out.push(pair);
        }
    };

    if let Ok((base, key)) = resolve_asr_credentials() {
        push(&base, &key);
    }
    if profile == DistributionProfile::Internal {
        if let Some(key) = map.get("YUNTUAI_API_KEY").filter(|s| !s.trim().is_empty()) {
            push("https://api.doohuan.com/v1", key);
        }
        if let Some(key) = embedded_relay_api_key() {
            push("https://api.doohuan.com/v1", key);
        }
    }
    if out.is_empty() {
        return Err("未配置 API Key，无法调用 Whisper 转写".to_string());
    }
    Ok(out)
}

fn bundled_support_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bundled")
        .join("support")
}

fn resolve_asr_script() -> Option<PathBuf> {
    let script_name = "yuntu-asr.ps1";
    if let Some(exe) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()))
    {
        for candidate in [
            exe.join("bundled").join("support").join(script_name),
            exe.join("resources")
                .join("bundled")
                .join("support")
                .join(script_name),
            exe.join("_up_")
                .join("bundled")
                .join("support")
                .join(script_name),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let dev = bundled_support_dir().join(script_name);
    if dev.is_file() {
        return Some(dev);
    }
    None
}

fn try_ffmpeg_to_wav(src: &Path) -> Option<PathBuf> {
    let out = src.with_extension("yuntu-asr-tmp.wav");
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-y",
        "-i",
        &src.to_string_lossy(),
        "-ac",
        "1",
        "-ar",
        "16000",
        &out.to_string_lossy(),
    ]);
    crate::openclaw_exec::hide_console(&mut cmd);
    let timed = crate::openclaw_exec::command_output_timed(cmd, Duration::from_secs(120))?;
    if timed.status.success() && out.is_file() {
        Some(out)
    } else {
        let _ = fs::remove_file(&out);
        None
    }
}

fn run_windows_speech_transcribe(audio_path: &Path, timeout_secs: u64) -> Result<String, String> {
    let script = resolve_asr_script().ok_or_else(|| "未找到内置 ASR 脚本".to_string())?;
    let wav_owned;
    let wav_path: &Path = if audio_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("wav"))
    {
        audio_path
    } else if let Some(converted) = try_ffmpeg_to_wav(audio_path) {
        wav_owned = converted;
        &wav_owned
    } else {
        return Err(
            "Windows 离线转写需要 WAV，或未安装 ffmpeg 无法转换。可安装 ffmpeg 或配置 Whisper API。"
                .to_string(),
        );
    };

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
        "-AudioPath",
        &wav_path.to_string_lossy(),
    ]);
    crate::openclaw_exec::hide_console(&mut cmd);
    let Some(out) = crate::openclaw_exec::command_output_timed(cmd, Duration::from_secs(timeout_secs))
    else {
        return Err(format!("Windows 离线转写超时（{timeout_secs}s）"));
    };
    if wav_path != audio_path {
        let _ = fs::remove_file(wav_path);
    }
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Windows 离线转写失败: {}", err.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn split_text_into_pseudo_segments(text: &str) -> Vec<WhisperSegment> {
    let mut segments = Vec::new();
    let mut cursor = 0.0f64;
    for chunk in text.split(['。', '！', '？', '\n']) {
        let t = chunk.trim();
        if t.is_empty() {
            continue;
        }
        let label = if t.ends_with(['。', '！', '？']) {
            t.to_string()
        } else {
            format!("{t}。")
        };
        let dur = (label.chars().count() as f64 * 0.18).clamp(1.0, 30.0);
        segments.push(WhisperSegment {
            start: cursor,
            end: cursor + dur,
            text: label,
        });
        cursor += dur + 0.4;
    }
    segments
}

fn append_multipart_field(body: &mut Vec<u8>, boundary: &str, name: &str, value: &str) {
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes(),
    );
}

fn append_multipart_file(
    body: &mut Vec<u8>,
    boundary: &str,
    name: &str,
    filename: &str,
    bytes: &[u8],
) {
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
}

fn call_whisper_at_endpoint(
    audio_path: &Path,
    base: &str,
    api_key: &str,
) -> Result<WhisperVerboseResponse, String> {
    call_whisper_at_endpoint_timed(audio_path, base, api_key, ASR_TIMEOUT_SECS)
}

fn call_whisper_at_endpoint_timed(
    audio_path: &Path,
    base: &str,
    api_key: &str,
    timeout_secs: u64,
) -> Result<WhisperVerboseResponse, String> {
    let url = format!("{}/audio/transcriptions", base.trim_end_matches('/'));
    let file_bytes = fs::read(audio_path).map_err(|e| format!("读取音频失败: {e}"))?;
    if file_bytes.is_empty() {
        return Err("音频文件为空".to_string());
    }
    let filename = audio_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audio.webm");

    let boundary = format!("----YunTuAI{}", Uuid::new_v4().simple());
    let mut body: Vec<u8> = Vec::new();
    append_multipart_field(&mut body, &boundary, "model", "whisper-1");
    append_multipart_field(&mut body, &boundary, "response_format", "verbose_json");
    append_multipart_field(&mut body, &boundary, "language", "zh");
    append_multipart_file(&mut body, &boundary, "file", filename, &file_bytes);
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let resp = ureq::post(&url)
        .timeout(Duration::from_secs(timeout_secs))
        .set("Authorization", &format!("Bearer {api_key}"))
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send_bytes(&body)
        .map_err(|e| format!("Whisper 请求失败: {e}"))?;
    let status = resp.status();
    let raw = resp.into_string().map_err(|e| e.to_string())?;
    if status >= 400 {
        return Err(format!("Whisper API 错误 ({status}): {raw}"));
    }
    serde_json::from_str(&raw).map_err(|e| format!("解析 Whisper 结果失败: {e}"))
}

fn transcribe_live_wav_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < 44 {
        return Err("音频块过短".to_string());
    }
    if bytes.len() > LIVE_WAV_MAX_BYTES {
        return Err("音频块过大".to_string());
    }
    let tmp = std::env::temp_dir().join(format!("yuntu-live-asr-{}.wav", Uuid::new_v4()));
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时音频失败: {e}"))?;
    let result = transcribe_live_wav_file(&tmp);
    let _ = fs::remove_file(&tmp);
    result
}

/// 会议实时转写：仅走 Windows System.Speech（内置 `yuntu-asr.ps1`），不调用云端 Whisper。
fn transcribe_live_wav_file(path: &Path) -> Result<String, String> {
    #[cfg(not(windows))]
    {
        let _ = path;
        return Err("会议实时转写仅支持 Windows".to_string());
    }
    #[cfg(windows)]
    {
        if LIVE_SKIP_WINDOWS_ASR.load(Ordering::Relaxed) {
            return Err(
                "Windows 语音识别不可用。请安装中文语音包：设置 → 时间和语言 → 语音 → 添加语言 → 中文（简体）→ 勾选「语音识别」。"
                    .to_string(),
            );
        }
        match run_windows_speech_transcribe(path, 40) {
            Ok(text) if !text.trim().is_empty() => Ok(text.trim().to_string()),
            Ok(_) => Ok(String::new()),
            Err(e) => {
                let lower = e.to_ascii_lowercase();
                if lower.contains("speech engine unavailable")
                    || lower.contains("未找到内置 asr")
                    || lower.contains("install chinese")
                {
                    LIVE_SKIP_WINDOWS_ASR.store(true, Ordering::Relaxed);
                }
                Err(format!(
                    "Windows 语音识别失败：{e}。请确认已安装中文语音包（设置 → 时间和语言 → 语音）。"
                ))
            }
        }
    }
}

fn whisper_endpoint_is_chat_only(base: &str) -> bool {
    let lower = base.to_ascii_lowercase();
    lower.contains("api.deepseek.com") || lower.contains("dashscope.aliyuncs.com")
}

fn transcribe_audio_file(audio_path: &Path) -> Result<WhisperVerboseResponse, String> {
    let mut whisper_errors: Vec<String> = Vec::new();
    if let Ok(candidates) = asr_endpoint_candidates() {
        for (base, key) in candidates {
            if whisper_endpoint_is_chat_only(&base) {
                whisper_errors.push(format!(
                    "[{base}] 该接口不提供 Whisper 音频转写，已改走本机语音识别"
                ));
                continue;
            }
            match call_whisper_at_endpoint(audio_path, &base, &key) {
                Ok(resp) => return Ok(resp),
                Err(e) => whisper_errors.push(format!("[{base}] {e}")),
            }
        }
    }

    match run_windows_speech_transcribe(audio_path, 120) {
        Ok(text) if !text.trim().is_empty() => {
            let segments = split_text_into_pseudo_segments(&text);
            return Ok(WhisperVerboseResponse {
                text: text.clone(),
                segments,
            });
        }
        Ok(_) => whisper_errors.push("Windows 离线转写结果为空".to_string()),
        Err(e) => whisper_errors.push(format!("Windows 离线: {e}")),
    }

    Err(format!(
        "转写失败。Whisper: {}；离线兜底亦未成功。建议：① 配置支持 Whisper 的中转 API；② 安装 ffmpeg 后重试；③ 使用实时录制。",
        if whisper_errors.is_empty() {
            "无可用 Key".to_string()
        } else {
            whisper_errors.join(" | ")
        }
    ))
}

struct ImportSpeakerRotator {
    last_end_ms: i64,
    idx: usize,
}

impl ImportSpeakerRotator {
    fn next(&mut self, start_ms: i64, end_ms: i64) -> String {
        if self.last_end_ms > 0 && start_ms.saturating_sub(self.last_end_ms) > IMPORT_SPEAKER_GAP_MS {
            self.idx = (self.idx + 1) % MAX_SPEAKERS;
        }
        self.last_end_ms = end_ms;
        SpeakerAssigner::label(self.idx)
    }
}

fn insert_transcribed_segments(
    conn: &rusqlite::Connection,
    session_id: &str,
    whisper: &WhisperVerboseResponse,
) -> Result<usize, String> {
    let now = now_iso();
    conn.execute(
        "DELETE FROM meeting_segments WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM meeting_digests WHERE session_id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE meeting_sessions SET last_digest_end_ms = 0, digest_count = 0, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    let mut count = 0usize;
    let mut speaker_rot = ImportSpeakerRotator {
        last_end_ms: 0,
        idx: 0,
    };

    let mut write_segment =
        |start_ms: i64, end_ms: i64, text: &str, speaker: &str| -> Result<(), String> {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(());
            }
            let id = new_id();
            conn.execute(
                "INSERT INTO meeting_segments (id, session_id, speaker, text, start_ms, end_ms, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, session_id, speaker, trimmed, start_ms, end_ms, now],
            )
            .map_err(|e| e.to_string())?;
            count += 1;
            Ok(())
        };

    if whisper.segments.is_empty() {
        let text = whisper.text.trim();
        if text.is_empty() {
            return Err("转写结果为空，请确认音频含清晰人声".to_string());
        }
        write_segment(0, 0, text, "A")?;
    } else {
        for seg in &whisper.segments {
            let start_ms = (seg.start * 1000.0).max(0.0) as i64;
            let end_ms = ((seg.end * 1000.0).max(seg.start * 1000.0 + 500.0)) as i64;
            let speaker = speaker_rot.next(start_ms, end_ms);
            write_segment(start_ms, end_ms, &seg.text, &speaker)?;
        }
    }

    if count == 0 {
        return Err("转写结果为空，请确认音频含清晰人声".to_string());
    }

    conn.execute(
        "UPDATE meeting_sessions SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub async fn meeting_transcribe_audio(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
    session_id: String,
) -> Result<MeetingTranscribeResult, String> {
    assert_authenticated(&state, &token)?;
    let audio_path = {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;

        let session = load_session_row(&conn, &session_id)?;
        session
            .audio_path
            .as_ref()
            .filter(|p| !p.trim().is_empty())
            .cloned()
            .ok_or_else(|| "请先导入或录制音频".to_string())?
    };
    let path = Path::new(&audio_path);
    if !path.exists() {
        return Err("音频文件不存在，请重新导入".to_string());
    }

    let audio_owned = audio_path;
    let whisper = crate::ipc::run_blocking(move || transcribe_audio_file(Path::new(&audio_owned))).await?;
    let segment_count = {
        let conn = lock_conn(&state.conn);
        insert_transcribed_segments(&conn, &session_id, &whisper)?
    };

    if segment_count > 0 {
        let app_for_digest = app.clone();
        let session_for_digest = session_id.clone();
        if let Err(e) = crate::ipc::run_blocking(move || {
            run_period_digest(&app_for_digest, &session_for_digest, true)
        })
        .await
        {
            eprintln!("[YunTuAI meeting] post-transcribe digest: {e}");
        }
    }

    let conn = lock_conn(&state.conn);
    let live = build_live_state(&conn, &session_id, false, None)?;
    Ok(MeetingTranscribeResult {
        segment_count,
        live,
        digest_triggered: segment_count > 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingTranscribeResult {
    pub segment_count: usize,
    pub live: MeetingLiveState,
    pub digest_triggered: bool,
}

#[tauri::command]
pub async fn meeting_export_docx(
    state: State<'_, DbState>,
    token: String,
    session_id: String,
    speaker: Option<String>,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    let (session, digests, all_segments, segments, speaker_filter) = {
        let conn = lock_conn(&state.conn);
        let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
        require_session_owner(&conn, &session_id, &user_id)?;

        let session = load_session_row(&conn, &session_id)?;
        let digests = load_digests(&conn, &session_id)?;
        let all_segments = load_segments(&conn, &session_id)?;
        let mut segments = all_segments.clone();

        let speaker_filter = speaker
            .as_ref()
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty());

        if let Some(ref sp) = speaker_filter {
            if !matches!(sp.as_str(), "A" | "B" | "C") {
                return Err("发言人仅支持 A / B / C".to_string());
            }
            segments.retain(|s| s.speaker.eq_ignore_ascii_case(sp));
            if segments.is_empty() {
                return Err(format!("发言人 {sp} 暂无转写内容可导出"));
            }
        } else if segments.is_empty() && digests.is_empty() {
            return Err("暂无可导出的会议内容".to_string());
        }

        (session, digests, all_segments, segments, speaker_filter)
    };

    let paragraphs = build_export_paragraphs(
        &session,
        &digests,
        &segments,
        speaker_filter.as_deref(),
        &all_segments,
    );

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let base = sanitize_export_name(&session.title);
    let filename = match speaker_filter.as_deref() {
        Some(sp) => format!("{base}-发言人{sp}-{stamp}.docx"),
        None => format!("{base}-会议纪要-{stamp}.docx"),
    };

    let out_dir = resolve_output_dir()?.join("meetings");
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    let path = out_dir.join(&filename);
    write_meeting_docx(&path, &paragraphs)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn meeting_delete_session(
    state: State<'_, DbState>,
    supervisor: State<'_, MeetingSupervisor>,
    token: String,
    session_id: String,
) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    let conn = lock_conn(&state.conn);
    let (user_id, _, _) = resolve_authenticated_user(&conn, &token)?;
    require_session_owner(&conn, &session_id, &user_id)?;

    if let Ok(mut g) = supervisor.inner.lock() {
        if let Some(runtime) = g.remove(&session_id) {
            runtime.stop_flag.store(true, Ordering::Relaxed);
        }
    }

    conn.execute(
        "DELETE FROM meeting_sessions WHERE id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    let dir = paths::installed_dir()?
        .join("workspace")
        .join("meetings")
        .join(&session_id);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn char_trigger_respects_cooldown_and_threshold() {
        assert!(!should_trigger_digest(400, 20_000, false));
        assert!(should_trigger_digest(320, 50_000, false));
        assert!(should_trigger_digest(80, 95_000, false));
        assert!(!should_trigger_digest(40, 95_000, false));
        assert!(should_trigger_digest(600, 50_000, false));
        assert!(should_trigger_digest(1, 0, true));
        assert!(!should_trigger_digest(0, 100_000, false));
    }

    #[test]
    fn live_wav_rejects_short_or_huge_payload() {
        assert!(transcribe_live_wav_bytes(&[0u8; 10]).is_err());
        let huge = vec![0u8; LIVE_WAV_MAX_BYTES + 1];
        assert!(transcribe_live_wav_bytes(&huge).is_err());
    }
}
