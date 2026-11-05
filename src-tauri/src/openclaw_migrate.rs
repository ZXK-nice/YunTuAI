//! 将用户全局 `~/.openclaw` 中有价值的训练/配置数据复制到 YunTuAI 内置 `openclaw-data`。

use crate::openclaw::{probe_legacy_home_openclaw, stop_all_external_gateways};
use crate::openclaw_runtime::strip_bom;
use crate::openclaw_control::{
    adopt_environment, apply_yuntuai_policy, backup_to_vault, deep_merge_json, establish_absolute_control,
    unseal_for_write, ALLOWED_CONFIG,
};
use crate::paths;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const LEGACY_MIGRATE_DIRS: &[&str] = &[
    "workspace",
    "agents",
    "memory",
    "identity",
    "plugins",
    "extensions",
    "completions",
    "flows",
    "tasks",
    "devices",
    "canvas",
    "browser",
    "media",
    "workspace-worker",
    "sandboxes",
    "sandbox",
    "openclaw-weixin",
    "qqbot",
    ".deepseek",
];

const LEGACY_MIGRATE_SKIP: &[&str] = &[
    "node_modules",
    "logs",
    ".git",
    ".yuntuai",
    ".yuntuai-sealed",
];

const LEGACY_MIGRATE_FILES: &[&str] = &["exec-approvals.json"];

const MAX_MIGRATE_FILE_BYTES: u64 = 120 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawLegacyMigrationResult {
    pub ok: bool,
    pub legacy_dir: String,
    pub target_dir: String,
    pub copied_dirs: Vec<String>,
    pub copied_files: Vec<String>,
    pub skipped: Vec<String>,
    pub merged_env: bool,
    pub merged_config: bool,
    pub legacy_renamed_to: Option<String>,
    pub message: String,
}

pub fn legacy_richness_score(base: &Path) -> usize {
    let mut score = 0usize;
    for name in LEGACY_MIGRATE_DIRS {
        let p = base.join(name);
        if !p.exists() {
            continue;
        }
        score += 2;
        if p.is_dir()
            && fs::read_dir(&p)
                .map(|mut d| d.next().is_some())
                .unwrap_or(false)
        {
            score += 1;
        }
    }
    if base.join(".env").is_file() {
        score += 1;
    }
    if base.join("openclaw.json").is_file() {
        score += 2;
    }
    score
}

fn should_skip_entry(name: &str) -> bool {
    LEGACY_MIGRATE_SKIP.contains(&name)
        || name.ends_with(".bak")
        || name.contains(".bak.")
        || name.ends_with(".disabled-by-yuntuai")
        || name == "package.json"
        || name == "package-lock.json"
        || name == "cad_mcp.log"
        || name == "update-check.json"
        || name == "yuntuai.ico"
}

fn parse_env_map(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            out.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    out
}

fn merge_env_files(dest_path: &Path, legacy_path: &Path) -> Result<bool, String> {
    if let Some(parent) = dest_path.parent() {
        unseal_for_write(parent);
    }
    let dest_raw = if dest_path.is_file() {
        fs::read_to_string(dest_path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };
    let legacy_raw =
        fs::read_to_string(legacy_path).map_err(|e| format!("读取旧版 .env: {e}"))?;
    let mut merged = parse_env_map(&dest_raw);
    let legacy = parse_env_map(&legacy_raw);
    for (k, v) in legacy {
        if v.is_empty() {
            continue;
        }
        if k == "OPENCLAW_GATEWAY_TOKEN" {
            if merged.get(&k).map(|s| s.is_empty()).unwrap_or(true) {
                merged.insert(k, v);
            }
            continue;
        }
        if merged.get(&k).map(|s| s.is_empty()).unwrap_or(true) {
            merged.insert(k, v);
        }
    }
    let mut keys: Vec<_> = merged.keys().cloned().collect();
    keys.sort();
    let body: Vec<String> = keys
        .iter()
        .map(|k| format!("{}={}", k, merged[k]))
        .collect();
    let out = format!(
        "# 由 YunTuAI 从旧版 ~/.openclaw 合并\n{}\n",
        body.join("\n")
    );
    fs::write(dest_path, out).map_err(|e| format!("写入 .env: {e}"))?;
    Ok(true)
}

fn rewrite_json_paths(value: &mut Value, old_base: &str, new_base: &str) {
    let old_fwd = old_base.replace('\\', "/");
    let new_fwd = new_base.replace('\\', "/");
    match value {
        Value::String(s) => {
            if s.contains(old_base) {
                *s = s.replace(old_base, new_base);
            } else if s.contains(&old_fwd) {
                *s = s.replace(&old_fwd, &new_fwd);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_json_paths(item, old_base, new_base);
            }
        }
        Value::Object(map) => {
            for v in map.values_mut() {
                rewrite_json_paths(v, old_base, new_base);
            }
        }
        _ => {}
    }
}

fn merge_openclaw_json(target: &Path, legacy: &Path) -> Result<bool, String> {
    if let Some(parent) = target.parent() {
        unseal_for_write(parent);
    }
    let legacy_raw =
        fs::read_to_string(legacy).map_err(|e| format!("读取旧版服务配置文件: {e}"))?;
    let legacy_val: Value =
        serde_json::from_str(strip_bom(&legacy_raw)).map_err(|e| format!("解析旧版服务配置文件: {e}"))?;
    let mut root: Value = if target.is_file() {
        let raw = fs::read_to_string(target).map_err(|e| e.to_string())?;
        serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("解析服务配置文件: {e}"))?
    } else {
        json!({})
    };
    deep_merge_json(&mut root, legacy_val);
    let legacy_dir = legacy
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let target_dir = target
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    rewrite_json_paths(&mut root, &legacy_dir, &target_dir);
    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(target, out).map_err(|e| format!("写入服务配置文件: {e}"))?;
    Ok(true)
}

fn copy_tree_merge(
    src: &Path,
    dest: &Path,
    rel_prefix: &str,
    copied_files: &mut Vec<String>,
    skipped: &mut Vec<String>,
) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取 {src:?}: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_entry(&name) {
            skipped.push(format!("{rel_prefix}/{name}"));
            continue;
        }
        let src_path = entry.path();
        let dest_path = dest.join(&name);
        let rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            format!("{rel_prefix}/{name}")
        };
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            copy_tree_merge(&src_path, &dest_path, &rel, copied_files, skipped)?;
        } else if meta.is_file() {
            if meta.len() > MAX_MIGRATE_FILE_BYTES {
                skipped.push(format!("{rel} (文件过大)"));
                continue;
            }
            let should_copy = if !dest_path.is_file() {
                true
            } else {
                match (meta.modified().ok(), fs::metadata(&dest_path).ok().and_then(|m| m.modified().ok())) {
                    (Some(src_m), Some(dst_m)) => src_m > dst_m,
                    _ => true,
                }
            };
            if should_copy {
                if let Some(parent) = dest_path.parent() {
                    fs::create_dir_all(parent).ok();
                }
                fs::copy(&src_path, &dest_path)
                    .map_err(|e| format!("复制 {rel}: {e}"))?;
                copied_files.push(rel);
            } else {
                skipped.push(format!("{rel} (目标较新)"));
            }
        }
    }
    Ok(())
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.canonicalize()
        .ok()
        .zip(b.canonicalize().ok())
        .map(|(x, y)| x == y)
        .unwrap_or(false)
}

pub fn same_path_check(a: &Path, b: &Path) -> bool {
    same_path(a, b)
}

pub fn migrate_legacy_into_managed(rename_legacy: bool) -> Result<OpenClawLegacyMigrationResult, String> {
    let (legacy_exists, legacy_dir_opt) = probe_legacy_home_openclaw();
    let legacy_dir = legacy_dir_opt.ok_or_else(|| "未找到旧版用户目录".to_string())?;
    let legacy_path = PathBuf::from(&legacy_dir);
    if !legacy_exists || !legacy_path.is_dir() {
        return Err("未找到旧版用户目录".into());
    }

    let target = paths::openclaw_data_dir()?;
    if same_path(&legacy_path, &target) {
        return Err("当前已在旧目录运行，请直接使用内置服务数据目录".into());
    }

    if legacy_richness_score(&legacy_path) < 2 {
        return Err("旧版目录几乎没有可迁移的数据（workspace/agents/memory 等）".into());
    }

    stop_all_external_gateways();
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    unseal_for_write(&target);

    for name in ALLOWED_CONFIG {
        let _ = backup_to_vault(&target, name);
    }
    let _ = backup_to_vault(&target, ".env");

    let mut copied_dirs = Vec::new();
    let mut copied_files = Vec::new();
    let mut skipped = Vec::new();

    for dir_name in LEGACY_MIGRATE_DIRS {
        let src = legacy_path.join(dir_name);
        if !src.is_dir() {
            continue;
        }
        let dest = target.join(dir_name);
        copy_tree_merge(&src, &dest, dir_name, &mut copied_files, &mut skipped)?;
        copied_dirs.push(dir_name.to_string());
    }

    for file_name in LEGACY_MIGRATE_FILES {
        let src = legacy_path.join(file_name);
        if src.is_file() {
            let dest = target.join(file_name);
            fs::copy(&src, &dest).map_err(|e| format!("复制 {file_name}: {e}"))?;
            copied_files.push(file_name.to_string());
        }
    }

    for name in ALLOWED_CONFIG {
        if *name == "openclaw.json" {
            continue;
        }
        let src = legacy_path.join(name);
        let dest = target.join(name);
        if src.is_file() && !dest.is_file() {
            fs::copy(&src, &dest).map_err(|e| format!("复制 {name}: {e}"))?;
            copied_files.push(name.to_string());
        }
    }

    let merged_env = if legacy_path.join(".env").is_file() {
        merge_env_files(&target.join(".env"), &legacy_path.join(".env"))?
    } else {
        false
    };

    let merged_config = if legacy_path.join("openclaw.json").is_file() {
        merge_openclaw_json(&target.join("openclaw.json"), &legacy_path.join("openclaw.json"))?
    } else {
        false
    };

    let _ = adopt_environment(false)?;
    let _ = apply_yuntuai_policy()?;
    let ctrl = establish_absolute_control(true)?;

    let legacy_renamed_to = if rename_legacy {
        let backup_name = format!(
            ".openclaw.yuntuai-backup-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S")
        );
        let backup = legacy_path
            .parent()
            .map(|p| p.join(&backup_name))
            .unwrap_or_else(|| PathBuf::from(&backup_name));
        match fs::rename(&legacy_path, &backup) {
            Ok(()) => Some(backup.to_string_lossy().to_string()),
            Err(e) => {
                skipped.push(format!("未能重命名旧目录（可手动处理）: {e}"));
                None
            }
        }
    } else {
        None
    };

    let message = format!(
        "已从 {} 导入 {} 个目录、{} 个文件到内置服务数据目录。{}",
        legacy_dir,
        copied_dirs.len(),
        copied_files.len(),
        if legacy_renamed_to.is_some() {
            "旧目录已备份重命名，避免与内置环境混用。"
        } else {
            "建议完成后在资源管理器中手动重命名旧版用户目录，避免混用。"
        }
    );

    Ok(OpenClawLegacyMigrationResult {
        ok: ctrl.ok,
        legacy_dir,
        target_dir: target.to_string_lossy().to_string(),
        copied_dirs,
        copied_files,
        skipped,
        merged_env,
        merged_config,
        legacy_renamed_to,
        message,
    })
}
