//! 将 YunTuAI 精选技能复制到 OpenClaw 工作区，开箱即可办事。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::openclaw_control::{managed_openclaw_data_dir, resolve_workspace_dir};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

/// 办事向精选技能（目录名，对应 `.agents/skills/<dir>/SKILL.md`）。
const CURATED_SKILL_DIRS: &[&str] = &[
    "bilingual-pdf-translation",
    "full-output-enforcement",
    "paper-to-patent",
    "scipilot-writing",
    "scipilot-cite",
    "anti-vibe-writing",
    "skills-best-practices",
    "skill-development",
    "desktop-control",
    "tyc-it",
    "browser-use",
    "kret-rag-kb",
];

const BOOTSTRAP_MARKER_FILE: &str = "skills-bootstrap-v1.json";

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Err(format!("技能源目录不存在: {}", src.display()));
    }
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let from = entry.path();
        let to = dst.join(&name);
        if ft.is_dir() {
            copy_dir_all(&from, &to)?;
        } else if ft.is_file() {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn bundled_curated_skills_root() -> PathBuf {
    PathBuf::from("bundled/curated-skills")
}

fn dev_repo_skills_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    for _ in 0..8 {
        let candidate = dir.join(".agents").join("skills");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn resolve_skill_source(dir_name: &str) -> Option<PathBuf> {
    let bundled = bundled_curated_skills_root().join(dir_name);
    if bundled.join("SKILL.md").is_file() {
        return Some(bundled);
    }
    if let Some(repo) = dev_repo_skills_root() {
        let dev = repo.join(dir_name);
        if dev.join("SKILL.md").is_file() {
            return Some(dev);
        }
    }
    None
}

fn workspace_skills_dir(data_dir: &Path) -> PathBuf {
    resolve_workspace_dir(data_dir)
        .unwrap_or_else(|_| data_dir.join("workspace"))
        .join(".agents")
        .join("skills")
}

/// 仅安装单个 bundled 技能（已存在则跳过）。比全量 bootstrap 快，供可选能力按需启用。
pub fn install_bundled_skill(dir_name: &str) -> Result<bool, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let dest_root = workspace_skills_dir(&data_dir);
    fs::create_dir_all(&dest_root).map_err(|e| e.to_string())?;

    let dest = dest_root.join(dir_name);
    if dest.join("SKILL.md").is_file() {
        return Ok(false);
    }
    let Some(src) = resolve_skill_source(dir_name) else {
        return Err(format!("未找到技能源: {dir_name}"));
    };
    if dest.exists() {
        let _ = fs::remove_dir_all(&dest);
    }
    copy_dir_all(&src, &dest)?;
    eprintln!("[YunTuAI] 已安装技能: {dir_name}");
    Ok(true)
}

/// 复制尚未安装的精选技能；已存在 `SKILL.md` 的目录跳过。
pub fn bootstrap_curated_skills() -> Result<u32, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let dest_root = workspace_skills_dir(&data_dir);
    fs::create_dir_all(&dest_root).map_err(|e| e.to_string())?;

    let mut installed = 0u32;
    for name in CURATED_SKILL_DIRS {
        let dest = dest_root.join(name);
        if dest.join("SKILL.md").is_file() {
            continue;
        }
        let Some(src) = resolve_skill_source(name) else {
            eprintln!("[YunTuAI] 跳过技能 {name}：未找到 bundled 或开发源");
            continue;
        };
        if dest.exists() {
            let _ = fs::remove_dir_all(&dest);
        }
        copy_dir_all(&src, &dest)?;
        installed += 1;
        eprintln!("[YunTuAI] 已安装精选技能: {name}");
    }

    let marker_dir = data_dir.join(".yuntuai");
    fs::create_dir_all(&marker_dir).map_err(|e| e.to_string())?;
    let marker = marker_dir.join(BOOTSTRAP_MARKER_FILE);
    let payload = serde_json::json!({
        "installed": installed,
        "at": chrono_lite_now(),
        "skills": CURATED_SKILL_DIRS,
    });
    fs::write(
        marker,
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into()),
    )
    .map_err(|e| e.to_string())?;

    Ok(installed)
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[tauri::command]
pub fn openclaw_bootstrap_curated_skills(
    state: State<'_, DbState>,
    token: String,
) -> Result<u32, String> {
    assert_authenticated(&state, &token)?;
    bootstrap_curated_skills()
}

/// 更新 skills 目录 watch 标记，促使 OpenClaw 重新扫描工作区技能（免重启网关）。
pub(crate) fn touch_skills_watch_mark() -> Result<(), String> {
    let data_dir = managed_openclaw_data_dir()?;
    let skills_dir = workspace_skills_dir(&data_dir);
    fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    let marker = skills_dir.join(".yuntu-skills-reload");
    fs::write(&marker, chrono_lite_now()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn openclaw_touch_skills_watch(state: State<'_, DbState>, token: String) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    touch_skills_watch_mark()
}
