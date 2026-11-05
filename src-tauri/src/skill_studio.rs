//! 技能工坊：将用户定制的 SKILL.md 草稿写入 OpenClaw 工作区，并注册为默认可启用技能。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::owner::assert_owner;
use crate::openclaw_control::{deep_merge_json, managed_openclaw_data_dir, mark_gateway_config_stale};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::State;

const COMMUNITY_SKILL_DELIST_JSON: &str =
    include_str!("../../src/lib/skills/community-skill-delist.json");
const COMMUNITY_SKILL_CATALOG_JSON: &str =
    include_str!("../../src/lib/skills/community-skill-catalog.json");

fn delisted_community_skill_dirs() -> &'static HashSet<String> {
    static CACHE: OnceLock<HashSet<String>> = OnceLock::new();
    CACHE.get_or_init(|| {
        let mut set = HashSet::new();
        let delist: Value =
            serde_json::from_str(COMMUNITY_SKILL_DELIST_JSON).unwrap_or_else(|_| json!({}));
        if let Some(arr) = delist.get("dirNames").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    set.insert(s.to_string());
                }
            }
        }
        let categories: HashSet<String> = delist
            .get("categories")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        if categories.is_empty() {
            return set;
        }
        let catalog: Value =
            serde_json::from_str(COMMUNITY_SKILL_CATALOG_JSON).unwrap_or_else(|_| json!({}));
        if let Some(skills) = catalog.get("skills").and_then(|v| v.as_array()) {
            for skill in skills {
                let cat = skill.get("category").and_then(|v| v.as_str()).unwrap_or("");
                let dir = skill.get("dirName").and_then(|v| v.as_str()).unwrap_or("");
                if categories.contains(cat) && !dir.is_empty() {
                    set.insert(dir.to_string());
                }
            }
        }
        set
    })
}

fn is_community_skill_delisted(dir_name: &str) -> bool {
    delisted_community_skill_dirs().contains(dir_name)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStudioInstallResult {
    pub path: String,
    pub dir_name: String,
    pub config_registered: bool,
    pub register_error: Option<String>,
    pub gateway_reload_recommended: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledCommunitySkillsList {
    pub dir_names: Vec<String>,
    pub count: u32,
}

fn workspace_skills_dir(data_dir: &Path) -> PathBuf {
    crate::openclaw_control::resolve_workspace_dir(data_dir)
        .unwrap_or_else(|_| data_dir.join("workspace"))
        .join(".agents")
        .join("skills")
}

fn bundled_community_skills_root() -> PathBuf {
    PathBuf::from("bundled/community-skills")
}

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

fn validate_dir_name(dir_name: &str) -> Result<(), String> {
    let name = dir_name.trim();
    if name.len() < 3 || name.len() > 64 {
        return Err("技能目录名长度须在 3–64 字符之间".into());
    }
    let ok = name
        .bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
        && !name.ends_with('-')
        && !name.contains("--");
    if !ok {
        return Err("技能目录名仅允许小写字母、数字与单连字符".into());
    }
    Ok(())
}

/// 确保 frontmatter 含 `metadata.openclaw.always: true`，安装后默认进入技能目录。
fn ensure_always_metadata(skill_md: &str) -> String {
    let trimmed = skill_md.trim();
    if trimmed.contains("always: true") && trimmed.contains("openclaw:") {
        return trimmed.to_string();
    }
    if !trimmed.starts_with("---") {
        return format!(
            "---\nmetadata:\n  openclaw:\n    always: true\n---\n\n{trimmed}"
        );
    }
    let rest = &trimmed[3..];
    let Some(end) = rest.find("\n---") else {
        return format!(
            "---\nmetadata:\n  openclaw:\n    always: true\n---\n\n{trimmed}"
        );
    };
    let yaml = &rest[..end];
    let body = &rest[end + 4..];
    if yaml.contains("always: true") && yaml.contains("openclaw:") {
        return trimmed.to_string();
    }
    let mut yaml_out = yaml.trim_end().to_string();
    if !yaml_out.contains("metadata:") {
        yaml_out.push_str("\nmetadata:\n  openclaw:\n    always: true");
    } else if !yaml_out.contains("openclaw:") {
        yaml_out.push_str("\n  openclaw:\n    always: true");
    } else if !yaml_out.contains("always:") {
        yaml_out.push_str("\n    always: true");
    }
    format!("---\n{yaml_out}\n---{}", body)
}

/// OpenClaw 网关 `skills.entries.*` 仅接受 `{ enabled: bool }`，额外字段会导致启动失败。
fn normalize_skill_entry(value: &Value) -> Value {
    let enabled = value
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    json!({ "enabled": enabled })
}

fn skill_entry_needs_repair(value: &Value) -> bool {
    normalize_skill_entry(value) != *value
}

/// 剥离历史版本写入的 path/source/description 等非法字段，避免网关拒绝配置。
pub fn repair_invalid_skill_entries() -> Result<u32, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let path = data_dir.join("openclaw.json");
    if !path.is_file() {
        return Ok(0);
    }

    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;

    let Some(entries) = root
        .pointer_mut("/skills/entries")
        .and_then(|v| v.as_object_mut())
    else {
        return Ok(0);
    };

    let mut repaired = 0u32;
    for value in entries.values_mut() {
        if skill_entry_needs_repair(value) {
            *value = normalize_skill_entry(value);
            repaired += 1;
        }
    }

    if repaired == 0 {
        return Ok(0);
    }

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&path, out).map_err(|e| format!("写入服务配置文件: {e}"))?;
    mark_gateway_config_stale(&data_dir);
    eprintln!("[YunTuAI] 已修复 {repaired} 个 skills.entries 非法字段");
    Ok(repaired)
}

/// 仅写入 `skills.entries`（enabled），不改 `agents.list[].skills`，避免误切成严格白名单。
fn register_skill_in_openclaw_json(dir_name: &str) -> Result<(), String> {
    let data_dir = managed_openclaw_data_dir()?;
    let path = data_dir.join("openclaw.json");
    if !path.is_file() {
        return Err("服务配置文件不存在，技能仅写入工作区，需完成网关初始化后重试注册".into());
    }

    // 以目录名为 entries 键，避免 frontmatter name 与路径不一致
    let skill_name = dir_name.to_string();
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut root: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("解析服务配置文件: {e}"))?;

    let desired_entry = json!({ "enabled": true });

    if root
        .pointer(&format!("/skills/entries/{skill_name}"))
        .map(|v| v == &desired_entry)
        .unwrap_or(false)
    {
        return Ok(());
    }

    deep_merge_json(
        &mut root,
        json!({
            "skills": {
                "entries": {
                    skill_name.clone(): desired_entry
                }
            }
        }),
    );

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if out.trim() == raw.trim() {
        return Ok(());
    }

    fs::write(&path, out).map_err(|e| format!("写入服务配置文件: {e}"))?;
    mark_gateway_config_stale(&data_dir);
    eprintln!("[YunTuAI] 技能已注册并启用: {skill_name}");
    Ok(())
}

fn finish_install(dest_file: &Path, dir_name: &str) -> SkillStudioInstallResult {
    let register_result = register_skill_in_openclaw_json(dir_name);
    SkillStudioInstallResult {
        path: dest_file.to_string_lossy().into_owned(),
        dir_name: dir_name.to_string(),
        config_registered: register_result.is_ok(),
        register_error: register_result.err(),
        gateway_reload_recommended: true,
    }
}

/// 将旧版 `workspace/skills` 迁移到 `workspace/.agents/skills`（幂等）。
pub fn migrate_legacy_workspace_skills() -> Result<u32, String> {
    let data_dir = managed_openclaw_data_dir()?;
    let workspace = crate::openclaw_control::resolve_workspace_dir(&data_dir)?;
    let legacy = workspace.join("skills");
    let modern = workspace_skills_dir(&data_dir);
    if !legacy.is_dir() {
        return Ok(0);
    }
    fs::create_dir_all(&modern).map_err(|e| e.to_string())?;
    let mut moved = 0u32;
    for entry in fs::read_dir(&legacy).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if validate_dir_name(&name).is_err() {
            continue;
        }
        if !entry.path().join("SKILL.md").is_file() {
            continue;
        }
        let dest = modern.join(&name);
        if dest.exists() {
            continue;
        }
        if copy_dir_all(&entry.path(), &dest).is_ok() {
            moved += 1;
        }
    }
    if moved > 0 {
        eprintln!("[YunTuAI] 已从 workspace/skills 迁移 {moved} 个技能到 .agents/skills");
    }
    Ok(moved)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkillsList {
    pub dir_names: Vec<String>,
    pub count: u32,
}

fn list_installed_skill_dir_names() -> Vec<String> {
    let Ok(data_dir) = managed_openclaw_data_dir() else {
        return Vec::new();
    };
    let root = workspace_skills_dir(&data_dir);
    let mut dir_names: Vec<String> = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            if entry.path().is_dir() && entry.path().join("SKILL.md").is_file() {
                dir_names.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    dir_names.sort();
    dir_names
}

pub fn list_installed_skills() -> InstalledSkillsList {
    let dir_names = list_installed_skill_dir_names();
    let count = dir_names.len() as u32;
    InstalledSkillsList { dir_names, count }
}

pub fn list_bundled_community_skills() -> BundledCommunitySkillsList {
    let root = bundled_community_skills_root();
    let mut dir_names: Vec<String> = Vec::new();
    if let Ok(rd) = fs::read_dir(&root) {
        for entry in rd.flatten() {
            if entry.path().is_dir() && entry.path().join("SKILL.md").is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if is_community_skill_delisted(&name) {
                    continue;
                }
                dir_names.push(name);
            }
        }
    }
    dir_names.sort();
    let count = dir_names.len() as u32;
    BundledCommunitySkillsList { dir_names, count }
}

pub fn install_skill_studio_draft(dir_name: &str, skill_md: &str) -> Result<SkillStudioInstallResult, String> {
    validate_dir_name(dir_name)?;
    let content = ensure_always_metadata(skill_md);
    if content.is_empty() {
        return Err("SKILL.md 内容为空".into());
    }
    if content.len() > 512_000 {
        return Err("SKILL.md 内容过大（上限 512KB）".into());
    }

    let data_dir = managed_openclaw_data_dir()?;
    let dest_root = workspace_skills_dir(&data_dir);
    let dest_dir = dest_root.join(dir_name);

    if dest_dir.exists() {
        return Err(format!(
            "技能目录「{dir_name}」已存在，为避免覆盖已有技能请更换目录名或手动删除后重试"
        ));
    }

    fs::create_dir_all(&dest_dir).map_err(|e| format!("创建技能目录失败: {e}"))?;
    let dest_file = dest_dir.join("SKILL.md");
    fs::write(&dest_file, &content).map_err(|e| format!("写入 SKILL.md 失败: {e}"))?;

    Ok(finish_install(&dest_file, dir_name))
}

pub fn install_community_skill(dir_name: &str) -> Result<SkillStudioInstallResult, String> {
    validate_dir_name(dir_name)?;
    if is_community_skill_delisted(dir_name) {
        return Err(format!("技能「{dir_name}」已下架，暂不可从技能工坊安装"));
    }
    let src = bundled_community_skills_root().join(dir_name);
    if !src.join("SKILL.md").is_file() {
        return Err(format!("安装包中未找到社区技能「{dir_name}」"));
    }

    let data_dir = managed_openclaw_data_dir()?;
    let dest_root = workspace_skills_dir(&data_dir);
    let dest_dir = dest_root.join(dir_name);
    if dest_dir.exists() {
        return Err(format!(
            "技能目录「{dir_name}」已安装，无需重复安装"
        ));
    }

    copy_dir_all(&src, &dest_dir)?;
    let dest_file = dest_dir.join("SKILL.md");
    if let Ok(raw) = fs::read_to_string(&dest_file) {
        let patched = ensure_always_metadata(&raw);
        if patched.trim() != raw.trim() {
            let _ = fs::write(&dest_file, &patched);
        }
    }

    Ok(finish_install(&dest_file, dir_name))
}

#[tauri::command]
pub fn skill_studio_list_bundled_community(
    state: State<'_, DbState>,
    token: String,
) -> Result<BundledCommunitySkillsList, String> {
    assert_authenticated(&state, &token)?;
    Ok(list_bundled_community_skills())
}

#[tauri::command]
pub fn skill_studio_list_installed(
    state: State<'_, DbState>,
    token: String,
) -> Result<InstalledSkillsList, String> {
    assert_authenticated(&state, &token)?;
    Ok(list_installed_skills())
}

#[tauri::command]
pub fn skill_studio_install_draft(
    state: State<'_, DbState>,
    token: String,
    dir_name: String,
    skill_md: String,
) -> Result<SkillStudioInstallResult, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    install_skill_studio_draft(&dir_name, &skill_md)
}

#[tauri::command]
pub fn skill_studio_install_community(
    state: State<'_, DbState>,
    token: String,
    dir_name: String,
) -> Result<SkillStudioInstallResult, String> {
    assert_authenticated(&state, &token)?;
    assert_owner(&state, &token)?;
    install_community_skill(&dir_name)
}

/// 扫描已安装技能：补 `always: true` 并写入 `skills.entries.enabled`。
/// 返回实际修补的技能数量。
pub fn migrate_installed_skills_auto_enable() -> Result<u32, String> {
    let _ = repair_invalid_skill_entries()?;

    let data_dir = managed_openclaw_data_dir()?;
    let root = workspace_skills_dir(&data_dir);
    if !root.is_dir() {
        return Ok(0);
    }
    let mut patched = 0u32;
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if validate_dir_name(&dir_name).is_err() {
            continue;
        }
        let skill_file = entry.path().join("SKILL.md");
        if !skill_file.is_file() {
            continue;
        }
        let raw = match fs::read_to_string(&skill_file) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let next = ensure_always_metadata(&raw);
        if next.trim() != raw.trim() && fs::write(&skill_file, &next).is_ok() {
            patched += 1;
        }
        let _ = register_skill_in_openclaw_json(&dir_name);
    }
    if patched > 0 {
        eprintln!("[YunTuAI] 已为 {patched} 个已装技能补上自动启用标记");
    }
    Ok(patched)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_dir_names() {
        assert!(validate_dir_name("ab").is_err());
        assert!(validate_dir_name("Bad-Name").is_err());
        assert!(validate_dir_name("../escape").is_err());
        assert!(validate_dir_name("valid-name-1").is_ok());
    }

    #[test]
    fn delisted_video_skill_blocked() {
        assert!(is_community_skill_delisted("video-creation-pro"));
        assert!(is_community_skill_delisted("agentkit-multimedia-shopping"));
        assert!(!is_community_skill_delisted("paper-to-patent"));
    }

    #[test]
    fn injects_always_metadata() {
        let md = "---\nname: demo\ndescription: x\n---\n\n# Hi\n";
        let out = ensure_always_metadata(md);
        assert!(out.contains("always: true"));
        assert!(out.contains("openclaw:"));
        assert!(out.contains("name: demo"));
    }

    #[test]
    fn normalizes_skill_entry_to_enabled_only() {
        let legacy = json!({
            "enabled": true,
            "source": "skill-studio",
            "path": ".agents/skills/demo/SKILL.md",
            "description": "x"
        });
        assert!(skill_entry_needs_repair(&legacy));
        assert_eq!(
            normalize_skill_entry(&legacy),
            json!({ "enabled": true })
        );
        assert!(!skill_entry_needs_repair(&json!({ "enabled": false })));
    }
}
