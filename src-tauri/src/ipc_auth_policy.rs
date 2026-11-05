//! IPC 命令鉴权策略表：与 `lib.rs` 中 `generate_handler!` 注册列表保持同步，供 CI 校验。
#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcAuthTier {
    /// 无需登录会话（仍可能受 license / 安装封印等业务规则约束）
    Public,
    /// 需有效登录 token（`assert_authenticated`）
    Session,
    /// 需 Owner 解锁（`assert_owner`）
    Owner,
}

#[derive(Debug, Clone, Copy)]
pub struct IpcCommandPolicy {
    pub name: &'static str,
    pub tier: IpcAuthTier,
}

/// 与 `tauri::generate_handler!` 中命令名一一对应（snake_case Rust 函数名）。
pub const IPC_COMMAND_POLICIES: &[IpcCommandPolicy] = &[
    // --- 公开 / 门闸 ---
    IpcCommandPolicy { name: "auth_gate_status", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_has_users", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_register", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_login", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_owner_emergency_login", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_dev_skip_login", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "auth_dev_auto_login", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "check_license", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "owner_emergency_login_enabled_cmd", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "yuntuai_launch_context", tier: IpcAuthTier::Public },
    IpcCommandPolicy { name: "openclaw_distribution_profile_cmd", tier: IpcAuthTier::Public },
    // --- Owner 专属 ---
    IpcCommandPolicy { name: "audit_list", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "audit_export_json", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "auth_admin_reset_password", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "auth_delete_user", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "auth_set_user_role", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "auth_list_users", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "module_install", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "module_uninstall", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "module_set_enabled", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "module_save_config", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "activate_license", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "generate_license_content", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "install_license", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_control_adopt", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_control_write_config", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_control_enforce", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_control_ai_access_set", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_switch_data_root_cmd", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "skill_studio_install_draft", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "skill_studio_install_community", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "app_install_msi_update", tier: IpcAuthTier::Owner },
    // --- 会话（默认）---
    IpcCommandPolicy { name: "openclaw_dir_status", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "get_gateway_connect_credentials", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_health_json", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_start", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_stop", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_stop_all_gateways", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_suppress_external", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_restart", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_status", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_ensure", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_stop", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_restart", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_reclaim", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_lifecycle_snapshot", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_service_diagnostic_snapshot", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_supervisor_request_recovery", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_event_persist_batch", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "gateway_events_list", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_exclusive_report", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_control_discover", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_control_read_config", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_control_ai_access_status", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_establish_absolute_control", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "openclaw_migrate_from_legacy", tier: IpcAuthTier::Owner },
    IpcCommandPolicy { name: "chat_get_output_dir", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_set_output_dir", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_pick_output_folder", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_save_upload_files", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_inspect_dropped_paths", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_save_upload_paths", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_read_file_base64", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_read_text_preview", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_extract_office_context", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_ocr_image_paths", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_write_office_output", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_open_file", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_scan_data_roots_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "reveal_path_in_os_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "chat_scan_new_output_files", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_read_mcp_servers", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_provision_status", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_provision_start", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_bootstrap_curated_skills", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_touch_skills_watch", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "kb_assistant_status_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "kb_assistant_enable_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "kb_assistant_disable_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "kb_assistant_save_config_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "kb_assistant_probe_health_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "skill_studio_list_bundled_community", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "skill_studio_list_installed", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "loop_engineering_status_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_runtime_set", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_runtime_switch", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_env_status_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_resync_relay_api_key_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "yuntuai_consume_upgrade_notice", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_env_save_keys_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_env_set_model", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_env_get_model", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_env_list_models", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "llm_user_list_presets", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "llm_user_list_slots", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "llm_user_save_slot", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "llm_user_clear_slot", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_memory_limit", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "openclaw_gateway_memory_limit_save", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_list_sessions", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_create_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_delete_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_append_message", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_delete_message", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_collapse_replayed_messages", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_list_messages", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_clear_session_messages", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_set_remote_session_key", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_set_session_agent", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_update_session_title", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_create_task", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_list_tasks", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_update_task_status", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_get_task", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "audit_append_event", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_check_integrity", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_run_maintenance", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "db_try_autobackup", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "auth_logout", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "auth_resume_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "auth_change_password", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "auth_cleanup_expired_tokens", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "owner_login", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "owner_logout", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "owner_session_status_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "module_list", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "module_get_config", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "module_validate_manifest", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "module_scan_dir", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_test_connection_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_config_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_save_config_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_use_chat_api_key_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_create_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_pick_references_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_list_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_delete_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_export_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "image_gen_reveal_folder_cmd", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_create_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_list_sessions", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_get_live_state", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_load_older_segments", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_start_recording", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_push_segment", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_push_audio_chunk", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_transcribe_live_chunk", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_stop_recording", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_trigger_digest", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_update_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_update_segment", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_import_audio", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_transcribe_audio", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_export_docx", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "meeting_delete_session", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "app_check_update", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "app_consume_update_failure_hint", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "app_system_info", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "yuntuai_run_diagnose_report", tier: IpcAuthTier::Session },
    IpcCommandPolicy { name: "yuntuai_repair_service_config", tier: IpcAuthTier::Session },
];

pub fn tier_for_command(name: &str) -> Option<IpcAuthTier> {
    IPC_COMMAND_POLICIES
        .iter()
        .find(|p| p.name == name)
        .map(|p| p.tier)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn ipc_command_names_are_unique() {
        let mut seen = HashSet::new();
        for p in IPC_COMMAND_POLICIES {
            assert!(
                seen.insert(p.name),
                "duplicate IPC command policy: {}",
                p.name
            );
        }
    }

    #[test]
    fn ipc_registry_covers_expected_volume() {
        assert!(
            IPC_COMMAND_POLICIES.len() >= 140,
            "expected >=140 IPC commands, got {}",
            IPC_COMMAND_POLICIES.len()
        );
    }

    #[test]
    fn owner_sensitive_commands_are_tier_owner() {
        let owner_cmds = [
            "app_install_msi_update",
            "skill_studio_install_draft",
            "skill_studio_install_community",
            "module_install",
            "audit_export_json",
            "openclaw_control_adopt",
        ];
        for name in owner_cmds {
            assert_eq!(
                tier_for_command(name),
                Some(IpcAuthTier::Owner),
                "{name} must be Owner tier"
            );
        }
    }

    #[test]
    fn public_gate_commands_are_tier_public() {
        for name in [
            "auth_login",
            "auth_register",
            "auth_gate_status",
            "check_license",
        ] {
            assert_eq!(
                tier_for_command(name),
                Some(IpcAuthTier::Public),
                "{name} must be Public tier"
            );
        }
    }

    #[test]
    fn ipc_registry_matches_lib_rs_handler() {
        let lib_rs = std::fs::read_to_string("src/lib.rs").expect("read lib.rs");
        let policy_rs =
            std::fs::read_to_string("src/ipc_auth_policy.rs").expect("read ipc_auth_policy.rs");
        let registered = parse_handler_commands_for_test(&lib_rs);
        let policy = parse_policy_names_for_test(&policy_rs);
        assert_eq!(
            registered, policy,
            "ipc_auth_policy.rs must match lib.rs generate_handler!"
        );
    }

    fn parse_handler_commands_for_test(lib_rs: &str) -> Vec<String> {
        let start = lib_rs
            .find("generate_handler![")
            .expect("generate_handler");
        let rest = &lib_rs[start..];
        let end = rest.find("])").expect("handler close");
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

    fn parse_policy_names_for_test(policy_rs: &str) -> Vec<String> {
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
}
