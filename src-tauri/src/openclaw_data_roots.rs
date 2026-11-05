//! 扫描本机可能存在的多套 openclaw-data，供前端提示用户避免配置/技能分叉。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::owner::assert_owner;
use crate::openclaw_control::{
    hash_config_files, hash_env_drift_keys, load_manifest, managed_openclaw_data_dir, save_manifest,
    resolve_workspace_dir,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDataRootEntry {
    pub path: String,
    pub label: String,
    pub is_active: bool,
    pub has_openclaw_json: bool,
    pub skill_dir_count: usize,
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDataRootsReport {
    pub active_path: String,
    pub entries: Vec<OpenClawDataRootEntry>,
    pub has_duplicates: bool,
}

fn modified_ms(path: &Path) -> Option<u64> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn count_skill_dirs(workspace_skills: &Path) -> usize {
    fs::read_dir(workspace_skills)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| {
                    e.path().is_dir()
                        && (e.path().join("SKILL.md").is_file()
                            || e.path().join("skill.md").is_file())
                })
                .count()
        })
        .unwrap_or(0)
}

fn entry_for(path: PathBuf, label: &str, active: &Path) -> OpenClawDataRootEntry {
    let has_openclaw_json = path.join("openclaw.json").is_file();
    let ws = resolve_workspace_dir(&path).unwrap_or_else(|_| path.join("workspace"));
    let skill_dir_count =
        count_skill_dirs(&ws.join("skills")) + count_skill_dirs(&ws.join(".agents").join("skills"));
    OpenClawDataRootEntry {
        is_active: path == active,
        path: path.to_string_lossy().to_string(),
        label: label.to_string(),
        has_openclaw_json,
        skill_dir_count,
        modified_ms: modified_ms(&path.join("openclaw.json")),
    }
}

fn push_unique(entries: &mut Vec<OpenClawDataRootEntry>, candidate: OpenClawDataRootEntry) {
    if entries.iter().any(|e| e.path == candidate.path) {
        return;
    }
    if candidate.has_openclaw_json || candidate.is_active {
        entries.push(candidate);
    }
}

fn collect_data_root_entries(active: &Path) -> Vec<OpenClawDataRootEntry> {
    let mut entries: Vec<OpenClawDataRootEntry> = Vec::new();

    push_unique(
        &mut entries,
        entry_for(active.to_path_buf(), "当前使用", active),
    );

    if let Ok(default_dir) = crate::paths::openclaw_data_dir() {
        push_unique(
            &mut entries,
            entry_for(default_dir, "安装默认", active),
        );
    }

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("YunTuAI").join("openclaw-data");
        push_unique(&mut entries, entry_for(p, "LocalAppData", active));
    }
    if let Ok(roam) = std::env::var("APPDATA") {
        let p = PathBuf::from(roam).join("YunTuAI").join("openclaw-data");
        push_unique(&mut entries, entry_for(p, "Roaming", active));
    }
    if let Ok(Some(m)) = load_manifest() {
        let p = PathBuf::from(m.data_dir.trim());
        if p.is_dir() {
            push_unique(&mut entries, entry_for(p, "管控清单", active));
        }
    }
    let (legacy_exists, legacy_dir) = crate::openclaw::probe_legacy_home_openclaw();
    if legacy_exists {
        if let Some(dir) = legacy_dir {
            let p = PathBuf::from(dir);
            if p.is_dir() {
                push_unique(&mut entries, entry_for(p, "旧版用户目录", active));
            }
        }
    }

    entries.sort_by(|a, b| {
        b.is_active
            .cmp(&a.is_active)
            .then_with(|| b.skill_dir_count.cmp(&a.skill_dir_count))
            .then_with(|| b.modified_ms.cmp(&a.modified_ms))
    });
    entries
}

#[tauri::command]
pub fn openclaw_scan_data_roots_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawDataRootsReport, String> {
    assert_authenticated(&state, &token)?;

    let active = managed_openclaw_data_dir()?;
    let entries = collect_data_root_entries(&active);
    let has_duplicates = entries.iter().filter(|e| e.has_openclaw_json).count() > 1;

    Ok(OpenClawDataRootsReport {
        active_path: active.to_string_lossy().to_string(),
        entries,
        has_duplicates,
    })
}

#[tauri::command]
pub fn openclaw_switch_data_root_cmd(
    state: State<'_, DbState>,
    token: String,
    path: String,
) -> Result<OpenClawDataRootsReport, String> {
    assert_owner(&state, &token)?;

    let target = PathBuf::from(path.trim());
    if !target.is_dir() {
        return Err("目标路径不是有效目录".into());
    }
    if !target.join("openclaw.json").is_file() {
        return Err("目标目录缺少服务配置文件，无法切换".into());
    }

    let mut manifest = load_manifest()?.ok_or("尚未接管本机服务数据目录，请先在配置中执行「接管」")?;
    manifest.data_dir = target.to_string_lossy().to_string();
    manifest.config_hashes = hash_config_files(&target);
    manifest.env_hash = hash_env_drift_keys(&target);
    save_manifest(&manifest)?;
    // 切换后立即按新目录准备运行时环境，减少前后端状态漂移窗口
    let _ = crate::openclaw_env::prepare_gateway_runtime_env();

    let active = managed_openclaw_data_dir()?;
    let entries = collect_data_root_entries(&active);
    let has_duplicates = entries.iter().filter(|e| e.has_openclaw_json).count() > 1;

    Ok(OpenClawDataRootsReport {
        active_path: active.to_string_lossy().to_string(),
        entries,
        has_duplicates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_unique_skips_duplicate_paths() {
        let mut entries = Vec::new();
        let p = PathBuf::from(r"C:\a\openclaw-data");
        push_unique(
            &mut entries,
            entry_for(p.clone(), "one", &p),
        );
        push_unique(
            &mut entries,
            entry_for(p.clone(), "two", &p),
        );
        assert_eq!(entries.len(), 1);
    }
}
