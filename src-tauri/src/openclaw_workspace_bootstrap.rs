//! 将 YunTuAI 默认人格与循环工程文件写入 OpenClaw 工作区。
//! 人格可按版本升级（仅覆盖仍为托管模板的 SOUL.md）；其它文件仅在缺失时创建。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::openclaw_control::{managed_openclaw_data_dir, resolve_workspace_dir};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const SOUL_FILENAME: &str = "SOUL.md";
const AGENTS_FILENAME: &str = "AGENTS.md";
const HEARTBEAT_FILENAME: &str = "HEARTBEAT.md";
const IMPROVEMENTS_FILENAME: &str = "IMPROVEMENTS.md";

const PERSONALITY_VERSION: u32 = 2;
const MARKER_FILE: &str = "personality-bootstrap-v2.json";
const LEGACY_MARKER_FILE: &str = "personality-bootstrap-v1.json";
const LOOP_MARKER_FILE: &str = "loop-engineering-v1.json";
#[allow(dead_code)]
const HEARTBEAT_VERSION: u32 = 1;

const MANAGED_HEARTBEAT_SIGNATURES: &[&str] = &[
    "# 云图AI · 心跳清单",
    "self-improvement-review",
    "循环工程",
];

/// 仍为 YunTuAI 托管模板时的特征串（用于安全升级，避免覆盖用户重写）。
const MANAGED_SOUL_SIGNATURES: &[&str] = &[
    "# 云图AI · 办事人格",
    "# 云图AI · 主动办事人格",
    "本文件由 YunTuAI 安装包写入",
    "本文件由 YunTuAI 写入",
];

fn template_dir_bundled() -> PathBuf {
    PathBuf::from("bundled/workspace-template")
}

fn resolve_template_file(name: &str) -> Option<PathBuf> {
    let bundled = template_dir_bundled().join(name);
    if bundled.is_file() {
        return Some(bundled);
    }
    let mut dir = std::env::current_dir().ok()?;
    for _ in 0..8 {
        let candidate = dir
            .join("src-tauri")
            .join("bundled")
            .join("workspace-template")
            .join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let alt = dir.join("bundled").join("workspace-template").join(name);
        if alt.is_file() {
            return Some(alt);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn write_json_marker(data_dir: &Path, file: &str, payload: serde_json::Value) -> Result<(), String> {
    let marker_dir = data_dir.join(".yuntuai");
    fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
    fs::write(
        marker_dir.join(file),
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()),
    )
    .map_err(|e| e.to_string())
}

fn read_marker_version(data_dir: &Path) -> u32 {
    let dir = data_dir.join(".yuntuai");
    for name in [MARKER_FILE, LEGACY_MARKER_FILE] {
        let path = dir.join(name);
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(ver) = v.get("version").and_then(|x| x.as_u64()) {
                    return ver as u32;
                }
            }
        }
    }
    0
}

fn is_managed_soul(content: &str) -> bool {
    let t = content.trim();
    if t.is_empty() {
        return true;
    }
    MANAGED_SOUL_SIGNATURES.iter().any(|sig| content.contains(sig))
}

fn write_template_if_missing(workspace: &Path, name: &str) -> Result<bool, String> {
    let dest = workspace.join(name);
    if dest.is_file() {
        return Ok(false);
    }
    let Some(template) = resolve_template_file(name) else {
        eprintln!("[YunTuAI] 跳过工作区模板 {name}：未找到 bundled/workspace-template/{name}");
        return Ok(false);
    };
    let content = fs::read_to_string(&template).map_err(|e| {
        format!("读取模板 {} 失败: {e}", template.display())
    })?;
    if content.trim().is_empty() {
        return Err(format!("工作区模板 {name} 为空"));
    }
    fs::write(&dest, content).map_err(|e| format!("写入 {name} 失败: {e}"))?;
    eprintln!("[YunTuAI] 已写入工作区文件: {}", dest.display());
    Ok(true)
}

/// 若 `workspace/SOUL.md` 不存在或仍为托管旧版，写入/升级默认人格。
/// 返回 `true` 表示新写入或升级。
pub fn bootstrap_workspace_personality() -> Result<bool, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let workspace = resolve_workspace_dir(&data_dir)?;
    fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

    let dest = workspace.join(SOUL_FILENAME);
    let Some(template) = resolve_template_file(SOUL_FILENAME) else {
        eprintln!("[YunTuAI] 跳过人格模板：未找到 bundled/workspace-template/SOUL.md");
        return Ok(false);
    };

    let template_content = fs::read_to_string(&template).map_err(|e| {
        format!(
            "读取人格模板 {} 失败: {e}",
            template.display()
        )
    })?;
    if template_content.trim().is_empty() {
        return Err("人格模板 SOUL.md 为空".into());
    }

    let marker_ver = read_marker_version(&data_dir);
    let mut wrote = false;

    if !dest.is_file() {
        fs::write(&dest, &template_content).map_err(|e| format!("写入 {} 失败: {e}", dest.display()))?;
        wrote = true;
        eprintln!("[YunTuAI] 已写入默认人格: {}", dest.display());
    } else if marker_ver < PERSONALITY_VERSION {
        let existing = fs::read_to_string(&dest).unwrap_or_default();
        if is_managed_soul(&existing) {
            fs::write(&dest, &template_content)
                .map_err(|e| format!("升级 {} 失败: {e}", dest.display()))?;
            wrote = true;
            eprintln!(
                "[YunTuAI] 已升级默认人格到 v{PERSONALITY_VERSION}: {}",
                dest.display()
            );
        } else {
            eprintln!(
                "[YunTuAI] 跳过人格升级：检测到用户自定义 SOUL.md（marker v{marker_ver}）"
            );
        }
    }

    write_json_marker(
        &data_dir,
        MARKER_FILE,
        serde_json::json!({
            "version": PERSONALITY_VERSION,
            "installed": wrote || dest.is_file(),
            "upgraded": wrote,
            "at": chrono_lite_now(),
            "file": SOUL_FILENAME,
        }),
    )?;

    // 一并确保办事守则存在（不覆盖用户已有 AGENTS.md）
    let _ = write_template_if_missing(&workspace, AGENTS_FILENAME);

    Ok(wrote)
}

fn is_managed_heartbeat(content: &str) -> bool {
    let t = content.trim();
    if t.is_empty() {
        return true;
    }
    MANAGED_HEARTBEAT_SIGNATURES.iter().any(|sig| content.contains(sig))
}

fn upgrade_heartbeat_if_managed(workspace: &Path) -> Result<bool, String> {
    let dest = workspace.join(HEARTBEAT_FILENAME);
    let Some(template) = resolve_template_file(HEARTBEAT_FILENAME) else {
        return Ok(false);
    };
    let template_content = fs::read_to_string(&template).map_err(|e| e.to_string())?;
    if !dest.is_file() {
        fs::write(&dest, &template_content).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let existing = fs::read_to_string(&dest).unwrap_or_default();
    if is_managed_heartbeat(&existing) && !existing.contains("self-improvement-review") {
        fs::write(&dest, &template_content).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoopEngineeringStatus {
    pub heartbeat_present: bool,
    pub improvements_present: bool,
    pub agents_present: bool,
    pub heartbeat_configured: bool,
    pub improvements_preview: String,
    pub improvements_line_count: u32,
    pub loop_bootstrapped: bool,
}

/// 读取循环工程运行状态（工作区文件 + openclaw heartbeat 配置）。
pub fn read_loop_engineering_status() -> Result<LoopEngineeringStatus, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let workspace = resolve_workspace_dir(&data_dir)?;
    let heartbeat_present = workspace.join(HEARTBEAT_FILENAME).is_file();
    let improvements_path = workspace.join(IMPROVEMENTS_FILENAME);
    let improvements_present = improvements_path.is_file();
    let agents_present = workspace.join(AGENTS_FILENAME).is_file();

    let improvements_preview = if improvements_present {
        fs::read_to_string(&improvements_path)
            .unwrap_or_default()
            .chars()
            .take(1200)
            .collect()
    } else {
        String::new()
    };
    let improvements_line_count = improvements_preview.lines().count() as u32;

    let heartbeat_configured = data_dir.join("openclaw.json").is_file()
        && fs::read_to_string(data_dir.join("openclaw.json"))
            .ok()
            .map(|raw| raw.contains("\"heartbeat\""))
            .unwrap_or(false);

    let loop_bootstrapped = data_dir.join(".yuntuai").join(LOOP_MARKER_FILE).is_file();

    Ok(LoopEngineeringStatus {
        heartbeat_present,
        improvements_present,
        agents_present,
        heartbeat_configured,
        improvements_preview,
        improvements_line_count,
        loop_bootstrapped,
    })
}

/// 写入心跳自审与改进记录模板，并确保 openclaw.json 启用 heartbeat。
pub fn bootstrap_loop_engineering() -> Result<bool, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let workspace = resolve_workspace_dir(&data_dir)?;
    fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

    let mut wrote = false;
    if write_template_if_missing(&workspace, HEARTBEAT_FILENAME)? {
        wrote = true;
    }
    if upgrade_heartbeat_if_managed(&workspace)? {
        wrote = true;
    }
    if write_template_if_missing(&workspace, IMPROVEMENTS_FILENAME)? {
        wrote = true;
    }
    if write_template_if_missing(&workspace, AGENTS_FILENAME)? {
        wrote = true;
    }

    if crate::skill_studio::migrate_legacy_workspace_skills()? > 0 {
        wrote = true;
    }

    // 存量岗位技能补 always 标记，避免「装了却要用户提醒」
    if crate::skill_studio::migrate_installed_skills_auto_enable()? > 0 {
        wrote = true;
    }

    if crate::openclaw_control::ensure_heartbeat_defaults()? {
        wrote = true;
    }

    write_json_marker(
        &data_dir,
        LOOP_MARKER_FILE,
        serde_json::json!({
            "version": 1,
            "installed": true,
            "wrote": wrote,
            "at": chrono_lite_now(),
            "files": [HEARTBEAT_FILENAME, IMPROVEMENTS_FILENAME, AGENTS_FILENAME],
        }),
    )?;

    Ok(wrote)
}

#[tauri::command]
pub fn loop_engineering_status_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<LoopEngineeringStatus, String> {
    assert_authenticated(&state, &token)?;
    read_loop_engineering_status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn resolve_template_or_skip_in_ci() {
        let _ = resolve_template_file(SOUL_FILENAME);
        let _ = resolve_template_file(HEARTBEAT_FILENAME);
    }

    #[test]
    fn managed_soul_detects_templates() {
        assert!(is_managed_soul("# 云图AI · 办事人格\n\nx"));
        assert!(is_managed_soul("# 云图AI · 主动办事人格\n"));
        assert!(!is_managed_soul("# My custom soul\nbe quirky"));
    }

    #[test]
    fn marker_payload_shape() {
        let dir = std::env::temp_dir().join(format!(
            "yuntuai-personality-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&dir);
        write_json_marker(
            &dir,
            MARKER_FILE,
            serde_json::json!({
                "version": PERSONALITY_VERSION,
                "installed": true,
                "at": "1",
                "file": SOUL_FILENAME,
            }),
        )
        .expect("marker");
        let raw = fs::read_to_string(dir.join(".yuntuai").join(MARKER_FILE)).expect("read");
        let v: serde_json::Value = serde_json::from_str(&raw).expect("json");
        assert_eq!(v["version"], PERSONALITY_VERSION);
        assert_eq!(v["installed"], true);
        let _ = fs::remove_dir_all(&dir);
    }
}
