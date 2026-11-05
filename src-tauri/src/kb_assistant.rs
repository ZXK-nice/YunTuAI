//! 知识库助手（kb-assistant）：可选 Agent + kret-rag-kb 技能，默认关闭，在设置中启用。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::openclaw_control::{
    deep_merge_json, managed_openclaw_data_dir, mark_gateway_config_stale,
};
use crate::openclaw_env::{read_managed_env_map, write_managed_env_values};
use crate::openclaw_runtime::strip_bom;
use crate::openclaw_skill_bootstrap::{install_bundled_skill, touch_skills_watch_mark};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

pub const SKILL_ID: &str = "kret-rag-kb";
pub const AGENT_ID: &str = "kb-assistant";
const ENV_BASE_URL: &str = "KRET_RAG_BASE_URL";
const PROBE_TIMEOUT_MS: u64 = 3_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbAssistantStatus {
    pub enabled: bool,
    pub base_url: String,
    pub skill_installed: bool,
    pub agent_present: bool,
    pub health_ok: Option<bool>,
    pub health_message: Option<String>,
}

fn workspace_skills_dir(data_dir: &Path) -> PathBuf {
    crate::openclaw_control::resolve_workspace_dir(data_dir)
        .unwrap_or_else(|_| data_dir.join("workspace"))
        .join(".agents")
        .join("skills")
}

fn read_openclaw_root() -> Result<Value, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let path = data_dir.join("openclaw.json");
    if !path.is_file() {
        return Ok(Value::Object(Default::default()));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))
}

fn write_openclaw_root(root: &Value) -> Result<(), String> {
    let data_dir = managed_openclaw_data_dir()?;
    let path = data_dir.join("openclaw.json");
    let out = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| format!("写入服务配置文件: {e}"))?;
    mark_gateway_config_stale(&data_dir);
    Ok(())
}

fn skill_enabled_in_config(root: &Value) -> bool {
    root.pointer(&format!("/skills/entries/{SKILL_ID}/enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn agent_present_in_config(root: &Value) -> bool {
    root.get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
        .map(|arr| arr.iter().any(|item| item.get("id").and_then(|v| v.as_str()) == Some(AGENT_ID)))
        .unwrap_or(false)
}

fn read_base_url() -> String {
    read_managed_env_map()
        .ok()
        .and_then(|m| m.get(ENV_BASE_URL).cloned())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_default()
}

fn normalize_base_url(raw: &str) -> Result<String, String> {
    let url = raw.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("知识库服务地址不能为空".into());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("知识库服务地址须以 http:// 或 https:// 开头".into());
    }
    if url.len() > 256 {
        return Err("知识库服务地址过长".into());
    }
    Ok(url)
}

fn probe_kb_health(base_url: &str) -> (bool, String) {
    let url = format!("{base_url}/health");
    match ureq::get(&url)
        .timeout(Duration::from_millis(PROBE_TIMEOUT_MS))
        .call()
    {
        Ok(resp) => {
            let code = resp.status();
            if (200..300).contains(&code) {
                (true, "连接正常".into())
            } else {
                (false, format!("HTTP {code}"))
            }
        }
        Err(ureq::Error::Status(code, _)) => (false, format!("HTTP {code}")),
        Err(e) => (false, format!("无法连接（{PROBE_TIMEOUT_MS}ms 内无响应）: {e}")),
    }
}

fn kb_model_from_user_config(root: &Value) -> String {
    if let Some(current) = kb_agent_model_in_config(root) {
        return crate::distribution_policy::qualify_model_id(&current);
    }
    root.pointer("/agents/defaults/model/primary")
        .and_then(|v| v.as_str())
        .map(crate::distribution_policy::qualify_model_id)
        .unwrap_or_else(|| crate::distribution_policy::qualify_model_id(""))
}

fn kb_agent_spec(model_id: &str) -> Value {
    json!({
        "id": AGENT_ID,
        "name": "知识库助手",
        "model": model_id,
        "description": "专用于查询局域网 KRET-RAG 知识库。每个用户问题必须先检索再作答；无命中时明确说明「知识库未找到相关信息」；回答末尾列出参考来源文件名。",
        "skills": [SKILL_ID],
        "sandbox": { "mode": "off" }
    })
}

fn kb_agent_model_in_config(root: &Value) -> Option<String> {
    root.get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(AGENT_ID))
        })
        .and_then(|item| item.get("model"))
        .and_then(|m| m.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn repair_kb_agent_model_if_needed(root: &mut Value) -> Result<bool, String> {
    if !agent_present_in_config(root) {
        return Ok(false);
    }
    let current = kb_agent_model_in_config(root).unwrap_or_default();
    let fixed = crate::distribution_policy::qualify_model_id(&current);
    if current == fixed {
        return Ok(false);
    }
    upsert_kb_agent(root);
    write_openclaw_root(root)?;
    Ok(true)
}

fn upsert_kb_agent(root: &mut Value) {
    let model_id = kb_model_from_user_config(root);
    let spec = kb_agent_spec(&model_id);
    let list = root
        .pointer("/agents/list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut next_list = list;
    if let Some(idx) = next_list
        .iter()
        .position(|item| item.get("id").and_then(|v| v.as_str()) == Some(AGENT_ID))
    {
        let existing = next_list[idx].clone();
        if let Some(obj) = spec.as_object() {
            let mut merged = existing.as_object().cloned().unwrap_or_default();
            for (k, v) in obj {
                merged.insert(k.clone(), v.clone());
            }
            next_list[idx] = Value::Object(merged);
        }
    } else {
        next_list.push(spec);
    }

    deep_merge_json(root, json!({ "agents": { "list": next_list } }));
}

fn remove_kb_agent(root: &mut Value) {
    let Some(list) = root
        .pointer_mut("/agents/list")
        .and_then(|v| v.as_array_mut())
    else {
        return;
    };
    list.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(AGENT_ID));
}

fn set_skill_enabled(root: &mut Value, enabled: bool) {
    deep_merge_json(
        root,
        json!({
            "skills": {
                "entries": {
                    SKILL_ID: { "enabled": enabled }
                }
            }
        }),
    );
}

fn skill_installed() -> Result<bool, String> {
    let data_dir = managed_openclaw_data_dir()?;
    Ok(workspace_skills_dir(&data_dir)
        .join(SKILL_ID)
        .join("SKILL.md")
        .is_file())
}

pub fn kb_assistant_status(probe_health: bool) -> Result<KbAssistantStatus, String> {
    let mut root = read_openclaw_root()?;
    if skill_enabled_in_config(&root) && agent_present_in_config(&root) {
        let _ = repair_kb_agent_model_if_needed(&mut root);
    }
    let enabled = skill_enabled_in_config(&root) && agent_present_in_config(&root);
    let base_url = read_base_url();
    let skill_installed = skill_installed()?;
    let agent_present = agent_present_in_config(&root);

    let (health_ok, health_message) = if probe_health && !base_url.is_empty() {
        let (ok, msg) = probe_kb_health(&base_url);
        (Some(ok), Some(msg))
    } else {
        (None, None)
    };

    Ok(KbAssistantStatus {
        enabled,
        base_url,
        skill_installed,
        agent_present,
        health_ok,
        health_message,
    })
}

fn ensure_skill_files() -> Result<(), String> {
    if skill_installed()? {
        return Ok(());
    }
    install_bundled_skill(SKILL_ID)?;
    if !skill_installed()? {
        return Err(format!("未能安装技能 {SKILL_ID}，请确认安装包包含该技能后重试"));
    }
    Ok(())
}

pub fn kb_assistant_enable(base_url: &str) -> Result<KbAssistantStatus, String> {
    let base_url = normalize_base_url(base_url)?;
    let mut updates = HashMap::new();
    updates.insert(ENV_BASE_URL.to_string(), base_url);
    write_managed_env_values(&updates)?;

    ensure_skill_files()?;

    let mut root = read_openclaw_root()?;
    set_skill_enabled(&mut root, true);
    upsert_kb_agent(&mut root);
    write_openclaw_root(&root)?;

    let _ = touch_skills_watch_mark();

    kb_assistant_status(false)
}

pub fn kb_assistant_disable() -> Result<KbAssistantStatus, String> {
    let mut root = read_openclaw_root()?;
    set_skill_enabled(&mut root, false);
    remove_kb_agent(&mut root);
    write_openclaw_root(&root)?;

    let _ = touch_skills_watch_mark();

    kb_assistant_status(false)
}

pub fn kb_assistant_save_config(base_url: &str) -> Result<KbAssistantStatus, String> {
    let base_url = normalize_base_url(base_url)?;
    let mut updates = HashMap::new();
    updates.insert(ENV_BASE_URL.to_string(), base_url);
    write_managed_env_values(&updates)?;
    kb_assistant_status(false)
}

pub fn kb_assistant_probe_health(base_url: &str) -> Result<KbAssistantStatus, String> {
    let base_url = normalize_base_url(base_url)?;
    let (ok, msg) = probe_kb_health(&base_url);
    let mut status = kb_assistant_status(false)?;
    status.base_url = base_url;
    status.health_ok = Some(ok);
    status.health_message = Some(msg);
    Ok(status)
}

#[tauri::command]
pub async fn kb_assistant_status_cmd(
    state: State<'_, DbState>,
    token: String,
    probe_health: Option<bool>,
) -> Result<KbAssistantStatus, String> {
    assert_authenticated(&state, &token)?;
    let probe = probe_health.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || kb_assistant_status(probe))
        .await
        .map_err(|e| format!("读取知识库状态失败: {e}"))?
}

#[tauri::command]
pub async fn kb_assistant_enable_cmd(
    state: State<'_, DbState>,
    token: String,
    base_url: String,
) -> Result<KbAssistantStatus, String> {
    assert_authenticated(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || kb_assistant_enable(&base_url))
        .await
        .map_err(|e| format!("启用知识库助手失败: {e}"))?
}

#[tauri::command]
pub fn kb_assistant_disable_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<KbAssistantStatus, String> {
    assert_authenticated(&state, &token)?;
    kb_assistant_disable()
}

#[tauri::command]
pub fn kb_assistant_save_config_cmd(
    state: State<'_, DbState>,
    token: String,
    base_url: String,
) -> Result<KbAssistantStatus, String> {
    assert_authenticated(&state, &token)?;
    kb_assistant_save_config(&base_url)
}

#[tauri::command]
pub async fn kb_assistant_probe_health_cmd(
    state: State<'_, DbState>,
    token: String,
    base_url: String,
) -> Result<KbAssistantStatus, String> {
    assert_authenticated(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || kb_assistant_probe_health(&base_url))
        .await
        .map_err(|e| format!("连接测试失败: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_base_url_accepts_http() {
        assert_eq!(
            normalize_base_url("http://127.0.0.1:8000/").unwrap(),
            "http://127.0.0.1:8000"
        );
    }

    #[test]
    fn normalize_base_url_rejects_empty() {
        assert!(normalize_base_url("  ").is_err());
    }

    #[test]
    fn normalize_base_url_rejects_non_http() {
        assert!(normalize_base_url("ftp://x").is_err());
    }
}
