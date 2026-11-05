fn main() {
    let versions_path = std::path::Path::new("../scripts/openclaw-runtime-versions.json");
    if versions_path.is_file() {
        let raw = std::fs::read_to_string(versions_path).expect("read openclaw-runtime-versions.json");
        let v: serde_json::Value =
            serde_json::from_str(&raw).expect("parse openclaw-runtime-versions.json");
        println!(
            "cargo:rustc-env=OPENCLAW_RUNTIME_NODE_VERSION={}",
            v["nodeVersion"].as_str().unwrap_or("v22.14.0")
        );
        println!(
            "cargo:rustc-env=OPENCLAW_RUNTIME_OPENCLAW_VERSION={}",
            v["openClawVersion"].as_str().unwrap_or("2026.6.1")
        );
        println!(
            "cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_ARCHIVE={}",
            v["nodeWinArchive"].as_str().unwrap_or("node-v22.14.0-win-x64.zip")
        );
        println!(
            "cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_FOLDER={}",
            v["nodeWinFolder"].as_str().unwrap_or("node-v22.14.0-win-x64")
        );
        println!(
            "cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_SHA256={}",
            v["nodeWinSha256"].as_str().unwrap_or("")
        );
    } else {
        println!("cargo:rustc-env=OPENCLAW_RUNTIME_NODE_VERSION=v22.14.0");
        println!("cargo:rustc-env=OPENCLAW_RUNTIME_OPENCLAW_VERSION=2026.6.1");
        println!("cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_ARCHIVE=node-v22.14.0-win-x64.zip");
        println!("cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_FOLDER=node-v22.14.0-win-x64");
        println!("cargo:rustc-env=OPENCLAW_RUNTIME_NODE_WIN_SHA256=");
    }

    let profile = std::env::var("YUNTUAI_DISTRIBUTION_PROFILE").unwrap_or_else(|_| "internal".into());
    println!("cargo:rustc-env=YUNTUAI_DISTRIBUTION_PROFILE={profile}");
    println!("cargo:rerun-if-env-changed=YUNTUAI_DISTRIBUTION_PROFILE");

    // Release 默认要求设备授权；内部试用可设 YUNTUAI_LICENSE_REQUIRED=0 关闭
    println!("cargo:rerun-if-env-changed=YUNTUAI_LICENSE_REQUIRED");
    let license_at_build = if std::env::var("PROFILE").as_deref() == Ok("release") {
        std::env::var("YUNTUAI_LICENSE_REQUIRED").unwrap_or_else(|_| "1".into())
    } else {
        std::env::var("YUNTUAI_LICENSE_REQUIRED").unwrap_or_else(|_| "0".into())
    };
    println!("cargo:rustc-env=YUNTUAI_LICENSE_REQUIRED_AT_BUILD={}", license_at_build.trim());
    embed_license_secret_at_build(license_at_build.trim());

    if profile == "relay-station" {
        println!("cargo:rerun-if-env-changed=YUNTUAI_RELAY_BUILD_API_KEY");
        if let Ok(key) = std::env::var("YUNTUAI_RELAY_BUILD_API_KEY") {
            let trimmed = key.trim();
            if trimmed.is_empty() {
                panic!("relay-station 构建需要非空的 YUNTUAI_RELAY_BUILD_API_KEY");
            }
            println!("cargo:rustc-env=YUNTUAI_EMBEDDED_RELAY_API_KEY={trimmed}");
        } else if std::env::var("PROFILE").as_deref() == Ok("release") {
            panic!("relay-station release 构建需要环境变量 YUNTUAI_RELAY_BUILD_API_KEY");
        }
    }

    // Release Owner：必须专属 bcrypt 哈希；应急代登默认关闭。
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        println!("cargo:rerun-if-env-changed=YUNTUAI_OWNER_PASSWORD_HASH");
        println!("cargo:rerun-if-env-changed=YUNTUAI_OWNER_EMERGENCY_LOGIN");
        let emergency = std::env::var("YUNTUAI_OWNER_EMERGENCY_LOGIN").unwrap_or_else(|_| "0".into());
        let emergency_trim = emergency.trim();
        println!("cargo:rustc-env=YUNTUAI_OWNER_EMERGENCY_LOGIN_AT_BUILD={emergency_trim}");
        if let Ok(owner_hash) = std::env::var("YUNTUAI_OWNER_PASSWORD_HASH") {
            let trimmed = owner_hash.trim();
            if trimmed.is_empty() {
                if matches!(emergency_trim, "1" | "true" | "TRUE" | "yes" | "YES") {
                    panic!(
                        "YUNTUAI_OWNER_EMERGENCY_LOGIN=1 时必须设置 YUNTUAI_OWNER_PASSWORD_HASH（专属 bcrypt，禁止出厂默认）"
                    );
                }
            } else {
                println!("cargo:rustc-env=YUNTUAI_EMBEDDED_OWNER_HASH={trimmed}");
            }
        } else if matches!(emergency_trim, "1" | "true" | "TRUE" | "yes" | "YES") {
            panic!("YUNTUAI_OWNER_EMERGENCY_LOGIN=1 时必须设置 YUNTUAI_OWNER_PASSWORD_HASH");
        }
    }

    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let has_custom_protocol =
            std::env::var("CARGO_FEATURE_CUSTOM_PROTOCOL").ok().as_deref() == Some("1");
        if !has_custom_protocol {
            panic!(
                "Release 构建必须启用 default feature `custom-protocol`（嵌入 dist，禁止连 Vite 1420）。\n\
                 请使用: cargo build --release（勿加 --no-default-features）或 npm run tauri build"
            );
        }
        let bundled = std::path::Path::new("bundled/openclaw-portable");
        let zip = bundled.join("openclaw-portable-payload.zip");
        let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_else(|_| {
            if cfg!(target_os = "windows") {
                "windows".into()
            } else if cfg!(target_os = "macos") {
                "macos".into()
            } else {
                String::new()
            }
        });
        let launcher = match target_os.as_str() {
            "windows" => bundled.join("openclaw.cmd"),
            "macos" => bundled.join("openclaw.sh"),
            _ => bundled.join("openclaw.cmd"),
        };
        if !zip.is_file() {
            panic!(
                "Release build requires OpenClaw payload zip.\n\
                 Run: npm run prepare:openclaw (Windows) or bash scripts/prepare-openclaw-portable-macos.sh (macOS)\n\
                 Missing: {}",
                zip.display()
            );
        }
        if !launcher.is_file() {
            panic!(
                "Release build requires OpenClaw launcher.\n\
                 Missing: {}",
                launcher.display()
            );
        }
    }
    stage_curated_skills();
    stage_community_skills();
    ensure_workspace_personality_template();
    verify_ipc_auth_policy_matches_lib_rs();
    tauri_build::build()
}

fn ensure_workspace_personality_template() {
    let root = std::path::Path::new("bundled/workspace-template");
    for name in ["SOUL.md", "AGENTS.md", "HEARTBEAT.md", "IMPROVEMENTS.md"] {
        let path = root.join(name);
        if std::env::var("PROFILE").as_deref() == Ok("release") && !path.is_file() {
            panic!(
                "Release build requires workspace template.\n\
                 Missing: {}",
                path.display()
            );
        }
    }
}

/// Release + 授权开启时，将签发密钥编译进二进制，避免安装目录缺少 activation.secret 导致无法激活。
fn embed_license_secret_at_build(license_at_build: &str) {
    let license_on = matches!(license_at_build, "1" | "true" | "TRUE" | "yes" | "YES");
    if !license_on {
        return;
    }
    if std::env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }

    let from_env = std::env::var("YUNTUAI_LICENSE_SECRET")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Release 禁止回退 dev-activation.secret，避免生产 license.dat 与客户端二进制密钥不一致。
    let from_file = if from_env.is_none() {
        read_license_secret_file("../scripts/activation.secret")
    } else {
        None
    };

    let secret = from_env.or(from_file).unwrap_or_else(|| {
        panic!(
            "Release 构建已启用设备授权，但未找到签发密钥。\n\
             请设置环境变量 YUNTUAI_LICENSE_SECRET，或在 scripts/activation.secret 中配置密钥（勿提交 git）。"
        );
    });

    println!("cargo:rustc-env=YUNTUAI_EMBEDDED_LICENSE_SECRET={secret}");
}

fn read_license_secret_file(rel: &str) -> Option<String> {
    let path = std::path::Path::new(rel);
    if !path.is_file() {
        return None;
    }
    let raw = std::fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        return Some(t.to_string());
    }
    None
}

/// Release / dev 构建时将办事向精选技能打入 `bundled/curated-skills`。
fn stage_curated_skills() {
    const SKILLS: &[&str] = &[
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
    let src_root = std::path::Path::new("../.agents/skills");
    let dst_root = std::path::Path::new("bundled/curated-skills");
    if !src_root.is_dir() {
        return;
    }
    for name in SKILLS {
        let src = src_root.join(name);
        let dst = dst_root.join(name);
        if !src.join("SKILL.md").is_file() {
            continue;
        }
        if dst.is_dir() {
            let _ = std::fs::remove_dir_all(&dst);
        }
        if copy_dir_recursive(&src, &dst).is_ok() {
            println!("cargo:warning=Staged curated skill: {name}");
        }
    }
}

/// 将社区技能包打入 `bundled/community-skills`（构建前可用 scripts/stage_anbeime_skills.py 生成暂存）。
fn stage_community_skills() {
    let staging = std::path::Path::new("../.tmp-community-catalog-staging");
    let dst_root = std::path::Path::new("bundled/community-skills");
    let curated = std::path::Path::new("bundled/curated-skills");

    if staging.is_dir() {
        if dst_root.is_dir() {
            let _ = std::fs::remove_dir_all(dst_root);
        }
        if copy_dir_recursive(staging, dst_root).is_ok() {
            let _ = std::fs::remove_file(dst_root.join("STAGE-MANIFEST.json"));
            println!("cargo:warning=Staged community skills from .tmp-community-catalog-staging");
        }
    }

    // 开发/未打社区包时：用精选技能填充，避免 UI 完全不可安装
    if !dst_root.is_dir() || community_skill_dir_count(dst_root) == 0 {
        if curated.is_dir() {
            let _ = std::fs::create_dir_all(dst_root);
            if let Ok(entries) = std::fs::read_dir(curated) {
                for entry in entries.flatten() {
                    if !entry.path().is_dir() {
                        continue;
                    }
                    let name = entry.file_name();
                    let to = dst_root.join(&name);
                    if to.join("SKILL.md").is_file() {
                        continue;
                    }
                    let _ = copy_dir_recursive(&entry.path(), &to);
                }
            }
            println!("cargo:warning=Community skills fallback: copied curated skills");
        }
    } else if curated.is_dir() {
        // 已有社区包时仍合并精选技能（如 paper-to-patent），供技能工坊一键安装
        let _ = std::fs::create_dir_all(dst_root);
        if let Ok(entries) = std::fs::read_dir(curated) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let to = dst_root.join(entry.file_name());
                if to.join("SKILL.md").is_file() {
                    continue;
                }
                if copy_dir_recursive(&entry.path(), &to).is_ok() {
                    println!(
                        "cargo:warning=Merged curated skill into community bundle: {}",
                        entry.file_name().to_string_lossy()
                    );
                }
            }
        }
    }

    merge_agents_skills_into_community(dst_root);

    sync_community_bundle_manifest();
    verify_community_bundle_for_release();
}

/// 技能工坊额外技能：仅 SKILL.md 等小文件，依赖由用户首次使用时联网安装。
fn merge_agents_skills_into_community(dst_root: &std::path::Path) {
    const EXTRA_DIRS: &[&str] = &["scrapling"];
    let src_root = std::path::Path::new("../.agents/skills");
    if !src_root.is_dir() {
        return;
    }
    let _ = std::fs::create_dir_all(dst_root);
    for name in EXTRA_DIRS {
        let src = src_root.join(name);
        let dst = dst_root.join(name);
        if !src.join("SKILL.md").is_file() {
            continue;
        }
        if dst.join("SKILL.md").is_file() {
            continue;
        }
        if copy_dir_recursive(&src, &dst).is_ok() {
            println!("cargo:warning=Merged agents skill into community bundle: {name}");
        }
    }
}

fn community_skill_dir_count(root: &std::path::Path) -> usize {
    std::fs::read_dir(root)
        .ok()
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir() && e.path().join("SKILL.md").is_file())
                .count()
        })
        .unwrap_or(0)
}

fn load_delisted_dirs_from_manifest() -> std::collections::HashSet<String> {
    let mut set = std::collections::HashSet::new();
    let delist_path = std::path::Path::new("../src/lib/skills/community-skill-delist.json");
    let catalog_path = std::path::Path::new("../src/lib/skills/community-skill-catalog.json");
    let delist: serde_json::Value = if delist_path.is_file() {
        std::fs::read_to_string(delist_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if let Some(arr) = delist.get("dirNames").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                set.insert(s.to_string());
            }
        }
    }
    let categories: std::collections::HashSet<String> = delist
        .get("categories")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if categories.is_empty() || !catalog_path.is_file() {
        return set;
    }
    if let Ok(raw) = std::fs::read_to_string(catalog_path) {
        if let Ok(catalog) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(skills) = catalog.get("skills").and_then(|v| v.as_array()) {
                for skill in skills {
                    let cat = skill.get("category").and_then(|v| v.as_str()).unwrap_or("");
                    let dir = skill.get("dirName").and_then(|v| v.as_str()).unwrap_or("");
                    if categories.contains(cat) && !dir.is_empty() {
                        set.insert(dir.to_string());
                    }
                }
            }
        }
    }
    set
}

fn sync_community_bundle_manifest() {
    let bundle = std::path::Path::new("bundled/community-skills");
    let mut dir_names: Vec<String> = Vec::new();
    if bundle.is_dir() {
        if let Ok(rd) = std::fs::read_dir(bundle) {
            for entry in rd.flatten() {
                if entry.path().is_dir() && entry.path().join("SKILL.md").is_file() {
                    dir_names.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
    }
    dir_names.sort();
    let delisted = load_delisted_dirs_from_manifest();
    dir_names.retain(|d| !delisted.contains(d));

    let catalog_path = std::path::Path::new("../src/lib/skills/community-skill-catalog.json");
    let catalog_count = if catalog_path.is_file() {
        std::fs::read_to_string(catalog_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .map(|v| {
                v.get("skills")
                    .and_then(|s| s.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.get("dirName").and_then(|d| d.as_str()))
                            .filter(|d| !delisted.contains(*d))
                            .count()
                    })
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    } else {
        0
    };

    let missing: Vec<String> = if catalog_path.is_file() {
        std::fs::read_to_string(catalog_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .map(|v| {
                v.get("skills")
                    .and_then(|s| s.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.get("dirName").and_then(|d| d.as_str()))
                            .filter(|d| !delisted.contains(*d))
                            .filter(|d| !dir_names.iter().any(|b| b == d))
                            .map(|s| s.to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    let payload = serde_json::json!({
        "generatedAt": chrono_lite_build_now(),
        "bundledCount": dir_names.len(),
        "catalogCount": catalog_count,
        "dirNames": dir_names,
        "missingFromBundle": missing,
        "delistedCount": delisted.len(),
    });

    let out = std::path::Path::new("../src/lib/skills/community-skill-bundled.json");
    if let Some(parent) = out.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(s) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(out, format!("{s}\n"));
        println!("cargo:warning=Synced community-skill-bundled.json (bundled={})", dir_names.len());
    }
}

fn verify_community_bundle_for_release() {
    if std::env::var("PROFILE").as_deref() != Ok("release") {
        return;
    }
    let require_full = std::env::var("YUNTUAI_REQUIRE_FULL_COMMUNITY_PACK")
        .ok()
        .map(|v| matches!(v.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false);
    if !require_full {
        return;
    }
    let manifest = std::path::Path::new("../src/lib/skills/community-skill-bundled.json");
    if !manifest.is_file() {
        panic!("Release requires community-skill-bundled.json; run build with staged community pack");
    }
    let raw = std::fs::read_to_string(manifest).expect("read bundled manifest");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("parse bundled manifest");
    let bundled = v.get("bundledCount").and_then(|c| c.as_u64()).unwrap_or(0);
    let catalog = v.get("catalogCount").and_then(|c| c.as_u64()).unwrap_or(0);
    let missing = v
        .get("missingFromBundle")
        .and_then(|m| m.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    if missing > 0 || bundled < catalog {
        panic!(
            "Release community pack incomplete: bundled={bundled} catalog={catalog} missing={missing}. \
             Run scripts/pack-anbeime-community-skills.ps1 or stage_anbeime_skills.py before release."
        );
    }
}

fn chrono_lite_build_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &to)?;
        } else if ft.is_file() {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}

fn parse_handler_commands(lib_rs: &str) -> Vec<String> {
    let start = lib_rs
        .find("generate_handler![")
        .expect("lib.rs must contain generate_handler!");
    let rest = &lib_rs[start..];
    let end = rest.find("])").expect("generate_handler block must close");
    let block = &rest[..end];
    let mut out = Vec::new();
    for line in block.lines() {
        let line = line.trim();
        if line.is_empty() || line.contains("generate_handler!") {
            continue;
        }
        let line = line.trim_end_matches(',');
        let name = line.rsplit("::").next().unwrap_or(line).trim();
        out.push(name.to_string());
    }
    out.sort();
    out
}

fn parse_policy_command_names(policy_rs: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in policy_rs.lines() {
        if let Some(pos) = line.find("name: \"") {
            let rest = &line[pos + 7..];
            if let Some(end) = rest.find('"') {
                out.push(rest[..end].to_string());
            }
        }
    }
    out.sort();
    out
}

/// 编译期校验 `ipc_auth_policy.rs` 与 `lib.rs` 的 `generate_handler!` 列表一致。
fn verify_ipc_auth_policy_matches_lib_rs() {
    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/ipc_auth_policy.rs");
    let lib_rs = std::fs::read_to_string("src/lib.rs").expect("read src/lib.rs");
    let policy_rs =
        std::fs::read_to_string("src/ipc_auth_policy.rs").expect("read src/ipc_auth_policy.rs");
    let registered = parse_handler_commands(&lib_rs);
    let policy = parse_policy_command_names(&policy_rs);
    let only_registered: Vec<_> = registered
        .iter()
        .filter(|c| !policy.contains(c))
        .cloned()
        .collect();
    let only_policy: Vec<_> = policy
        .iter()
        .filter(|c| !registered.contains(c))
        .cloned()
        .collect();
    if !only_registered.is_empty() || !only_policy.is_empty() {
        panic!(
            "IPC auth policy out of sync with generate_handler!\n\
             missing from ipc_auth_policy.rs: {only_registered:?}\n\
             extra in ipc_auth_policy.rs: {only_policy:?}"
        );
    }
}
