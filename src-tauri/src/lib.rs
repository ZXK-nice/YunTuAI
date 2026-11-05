mod app_launch;
mod app_shutdown;
mod app_upgrade;
mod auth;
mod chat_files;
mod cli;
mod db;
mod distribution_policy;
mod gateway_lifecycle;
mod gateway_supervisor;
mod image_gen;
mod install_seal;
mod ipc;
mod ipc_auth_policy;
mod kb_assistant;
mod license;
mod llm_user_providers;
mod meeting;
mod module_manager;
mod ocr;
pub mod office_write;
mod service_config_repair;
mod support_diagnose;
mod user_facing_copy;
mod openclaw;
mod openclaw_bootstrap;
mod openclaw_control;
mod openclaw_data_roots;
mod openclaw_exec;
mod openclaw_env;
mod openclaw_migrate;
mod openclaw_platform;
mod openclaw_provision;
mod openclaw_relay_waf_patch;
mod openclaw_runtime;
mod openclaw_skill_bootstrap;
mod openclaw_workspace_bootstrap;
mod owner;
mod paths;
mod session_archive;
mod skill_studio;
mod system_info;
mod updater;

use auth::{
    auth_admin_reset_password, auth_change_password, auth_cleanup_expired_tokens, auth_delete_user,
    auth_gate_status, auth_has_users, auth_list_users, auth_login, auth_logout, auth_owner_emergency_login,
    auth_register, auth_resume_session, auth_dev_auto_login, auth_dev_skip_login,
    auth_set_user_role,
};
use owner::{owner_emergency_login_enabled_cmd, owner_login, owner_logout, owner_session_status_cmd};
use module_manager::{
    module_get_config, module_install, module_list, module_save_config, module_scan_dir,
    module_set_enabled, module_uninstall, module_validate_manifest,
};
use chat_files::{
    chat_extract_office_context, chat_get_output_dir, chat_inspect_dropped_paths, chat_ocr_image_paths,
    chat_write_office_output,
    chat_open_file, chat_pick_output_folder, chat_read_file_base64, chat_read_text_preview,
    chat_save_upload_files, chat_save_upload_paths, chat_scan_new_output_files, chat_set_output_dir,
    reveal_path_in_os_cmd,
};
use openclaw_data_roots::{openclaw_scan_data_roots_cmd, openclaw_switch_data_root_cmd};
use gateway_lifecycle::{
    gateway_event_persist_batch, gateway_events_list, gateway_lifecycle_snapshot, gateway_service_diagnostic_snapshot,
    gateway_supervisor_request_recovery,
};
use gateway_supervisor::{
    gateway_supervisor_ensure, gateway_supervisor_reclaim, gateway_supervisor_restart,
    gateway_supervisor_status, gateway_supervisor_stop, openclaw_exclusive_report,
    push_exclusive_report, start_exclusive_report_emitter, start_supervisor_health_watch, GatewaySupervisor,
};
use cli::{
    openclaw_gateway_health_json, openclaw_gateway_restart, openclaw_gateway_start,
    openclaw_gateway_stop, openclaw_stop_all_gateways, openclaw_suppress_external,
};
use db::{
    audit_append_event, audit_export_json, audit_list, db_append_message, db_check_integrity, db_clear_session_messages,
    db_create_session, db_create_task, db_delete_message, db_collapse_replayed_messages, db_delete_session, db_get_task, db_list_messages,
    db_list_sessions, db_list_tasks, db_run_maintenance, db_set_remote_session_key, db_set_session_agent, db_try_autobackup,
    db_update_session_title, db_update_task_status, init_db, spawn_durable_account_backup, DbState,
};
use image_gen::{
    image_gen_config_cmd, image_gen_create_cmd, image_gen_delete_cmd, image_gen_export_cmd,
    image_gen_list_cmd, image_gen_pick_references_cmd,
    image_gen_reveal_folder_cmd, image_gen_save_config_cmd, image_gen_test_connection_cmd,
    image_gen_use_chat_api_key_cmd,
};
use kb_assistant::{
    kb_assistant_disable_cmd, kb_assistant_enable_cmd, kb_assistant_probe_health_cmd,
    kb_assistant_save_config_cmd, kb_assistant_status_cmd,
};
use license::{activate_license, check_license, generate_license_content, install_license};
use llm_user_providers::{
    llm_user_clear_slot, llm_user_list_presets, llm_user_list_slots, llm_user_save_slot,
};
use meeting::{
    meeting_create_session, meeting_delete_session, meeting_export_docx, meeting_get_live_state,
    meeting_import_audio, meeting_list_sessions, meeting_load_older_segments, meeting_push_audio_chunk,
    meeting_push_segment, meeting_start_recording, meeting_stop_recording, meeting_transcribe_audio,
    meeting_transcribe_live_chunk, meeting_trigger_digest, meeting_update_segment,
    meeting_update_session, MeetingSupervisor,
};
use openclaw::{
    get_gateway_connect_credentials, openclaw_dir_status, openclaw_read_mcp_servers,
};
use openclaw_control::{
    openclaw_control_adopt, openclaw_control_ai_access_set, openclaw_control_ai_access_status,
    openclaw_control_discover, openclaw_control_enforce,
    openclaw_control_read_config, openclaw_control_write_config, openclaw_establish_absolute_control,
    openclaw_migrate_from_legacy,
};
use openclaw_env::{
    force_resync_embedded_relay_key, openclaw_env_get_model, openclaw_env_list_models,
    openclaw_env_save_keys_cmd, openclaw_env_set_model, openclaw_env_status_cmd,
    openclaw_distribution_profile_cmd,
};
use openclaw_provision::{
    openclaw_provision_start, openclaw_provision_status, openclaw_runtime_set,
    openclaw_runtime_switch,
    OpenClawProvisionState,
};
use openclaw_skill_bootstrap::{openclaw_bootstrap_curated_skills, openclaw_touch_skills_watch};
use openclaw_workspace_bootstrap::loop_engineering_status_cmd;
use skill_studio::{
    skill_studio_install_community, skill_studio_install_draft, skill_studio_list_bundled_community,
    skill_studio_list_installed,
};
use openclaw_runtime::{openclaw_gateway_memory_limit, openclaw_gateway_memory_limit_save};
use updater::{app_check_update, app_consume_update_failure_hint, app_install_msi_update};
use support_diagnose::run_diagnose_save_report;
use system_info::app_system_info;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

/// 系统托盘是否可用；若托盘未创建，不拦截 close 事件（避免窗口隐藏后无法恢复）
static TRAY_READY: AtomicBool = AtomicBool::new(false);

const DIAG_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// 诊断日志超过 2MB 时轮转一份 `.old`，避免长期运行撑满磁盘。
fn rotate_diagnostic_log_if_needed(path: &std::path::Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() <= DIAG_LOG_MAX_BYTES {
        return;
    }
    let old = path.with_file_name(format!(
        "{}.old",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("yuntuai.log")
    ));
    let _ = std::fs::remove_file(&old);
    let _ = std::fs::rename(path, &old);
}

fn append_diagnostic_log(path: &std::path::Path, line: &str) {
    rotate_diagnostic_log_if_needed(path);
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "{line}")
        });
}

/// 写入启动阶段日志到 exe 同目录的 yuntuai-startup.log，辅助闪退诊断。
fn log_startup_phase(phase: &str) {
    eprintln!("[YunTuAI STARTUP] {phase}");
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let log = dir.join("yuntuai-startup.log");
            append_diagnostic_log(
                &log,
                &format!(
                    "[{}] {}",
                    chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                    phase
                ),
            );
        }
    }
}

/// 注册全局 panic hook：panic 时写诊断文件 + stderr。
fn install_panic_hook() {
    let orig = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let file = info.location().map(|l| l.file()).unwrap_or("<unknown>");
        let line = info.location().map(|l| l.line()).unwrap_or(0);
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let msg = format!(
            "[YunTuAI CRASH] kernel panic: {}\n  at {}:{}\n",
            payload, file, line
        );
        eprintln!("{}", msg.trim());
        // 同时写入崩溃日志文件
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let log = dir.join("yuntuai-crash.log");
                append_diagnostic_log(
                    &log,
                    &format!(
                        "=== {} ===\n{}",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        msg.trim()
                    ),
                );
            }
        }
        // 仍调用原 hook（若有）
        orig(info);
    }));
}

/// 中转站：强制同步内嵌 API Key 到 .env 并重启监管网关（修复 403 / 旧密钥）。
#[tauri::command]
async fn openclaw_resync_relay_api_key_cmd(
    app: tauri::AppHandle,
    sup: tauri::State<'_, GatewaySupervisor>,
    state: tauri::State<'_, DbState>,
    token: String,
) -> Result<serde_json::Value, String> {
    crate::auth::assert_authenticated(&state, &token)?;
    let fingerprint = force_resync_embedded_relay_key()?;
    let status = sup.restart_nonblocking(&app, &state)?;
    push_exclusive_report(&app, &sup);
    Ok(serde_json::json!({
        "keyFingerprint": fingerprint,
        "gatewayRestarted": status.running,
    }))
}

/// 运行内置诊断脚本并将报告保存到安装目录 diagnostics/。
#[tauri::command]
async fn yuntuai_run_diagnose_report(
    state: tauri::State<'_, DbState>,
    token: String,
) -> Result<support_diagnose::DiagnoseReportResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        Ok(run_diagnose_save_report())
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            app_launch::show_main_window(app);
        }));
        builder = builder.plugin(
            tauri_plugin_autostart::Builder::new()
                .args([app_launch::TRAY_LAUNCH_ARG])
                .app_name("YunTuAI")
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 点 X / Alt+F4 不退出，隐藏到托盘；只有托盘「退出」才真正关闭
                if TRAY_READY.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let result: Result<(), Box<dyn std::error::Error>> = (|| {
            // 系统托盘：应用启动即创建，保证闭窗口后可恢复。
            // 使用 default_window_icon，若返回 None 则 fallback 到编译期 icon.png。
            {
                let show_item = MenuItemBuilder::with_id("yuntuai-tray-show", "显示主窗口")
                    .build(app)?;
                let quit_item = MenuItemBuilder::with_id("yuntuai-tray-quit", "退出 YunTuAI")
                    .build(app)?;
                let tray_menu = MenuBuilder::new(app)
                    .item(&show_item)
                    .separator()
                    .item(&quit_item)
                    .build()?;
                let tray_icon = app.default_window_icon().cloned().unwrap_or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
                        .expect("icon.png must be valid PNG")
                });
                let tray_result = TrayIconBuilder::with_id("yuntuai-tray")
                    .icon(tray_icon)
                    .menu(&tray_menu)
                    .tooltip("YunTuAI — 左键打开，右键退出")
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            app_launch::show_main_window(tray.app_handle());
                        }
                    })
                    .on_menu_event(|app, event| {
                        if event.id() == "yuntuai-tray-show" {
                            app_launch::show_main_window(app);
                        } else if event.id() == "yuntuai-tray-quit" {
                            // 快速退出：仅发 shutdown 信号 + 短杀子进程，立即 exit；备份与 CLI stop 走后台。
                            if let Some(sup) = app.try_state::<GatewaySupervisor>() {
                                sup.shutdown_on_app_exit();
                            } else {
                                app_shutdown::signal_app_shutdown();
                            }
                            app.exit(0);
                        }
                    })
                    .build(app);
                match tray_result {
                    Ok(_) => TRAY_READY.store(true, Ordering::Relaxed),
                    Err(e) => {
                        eprintln!("[YunTuAI] WARNING: tray icon creation failed (close will exit): {e}");
                    }
                }
            }

            {
                let ctx = app_launch::launch_context();
                if app_launch::should_start_with_hidden_window() {
                    app_launch::hide_main_window(app.handle());
                    log_startup_phase("setup: tray-only launch (main window hidden)");
                }
                if ctx.legacy_startup_bat {
                    log_startup_phase(
                        "WARN: 检测到「启动」文件夹中的 YunTuAI-AutoStart.bat，请删除以免重复自启",
                    );
                }
                if ctx.fresh_system_boot {
                    log_startup_phase(&format!(
                        "setup: fresh system boot (uptime {}ms, auto-ensure delay {}ms, grace {}ms)",
                        app_launch::system_uptime_ms(),
                        app_launch::auto_ensure_initial_delay_ms(),
                        ctx.startup_grace_ms,
                    ));
                }
            }

            log_startup_phase("setup: tray created");
            let provision = OpenClawProvisionState::default();
            app.manage(provision.clone());

            if let Err(e) = openclaw_bootstrap::bootstrap_openclaw_on_startup() {
                eprintln!("[YunTuAI] OpenClaw bootstrap: {e}");
            }
            log_startup_phase("setup: bootstrap done");
            chat_files::repair_output_workspace_link();
            let _ = crate::license::reconcile_license_on_startup();
            openclaw_runtime::reconcile_runtime_preference();
            if let Err(e) = openclaw_runtime::ensure_default_runtime_pref() {
                eprintln!("[YunTuAI] runtime pref: {e}");
            }
            openclaw_control::start_domination_watchdog();
            log_startup_phase("setup: watchdog started");
            if openclaw_provision::is_openclaw_available() {
                match std::thread::Builder::new()
                    .name("yuntuai-openclaw-establish".into())
                    .spawn(|| {
                        let result = std::panic::catch_unwind(|| {
                            let (tx, rx) = std::sync::mpsc::channel();
                            let tx_work = tx.clone();
                            match std::thread::Builder::new()
                                .name("yuntuai-openclaw-establish-work".into())
                                .spawn(move || {
                                    let r = openclaw_control::establish_absolute_control(true);
                                    let _ = tx_work.send(r);
                                })
                            {
                                Ok(work) => {
                                    gateway_supervisor::register_establish_work_handle(work);
                                }
                                Err(e) => {
                                    let _ = tx.send(Err(format!("establish work spawn failed: {e}")));
                                }
                            }
                            const ESTABLISH_TIMEOUT_SECS: u64 = if cfg!(debug_assertions) {
                                45
                            } else {
                                90
                            };
                            match rx.recv_timeout(std::time::Duration::from_secs(ESTABLISH_TIMEOUT_SECS)) {
                                Ok(Ok(_)) => {}
                                Ok(Err(e)) => {
                                    eprintln!("[YunTuAI] OpenClaw absolute control: {e}");
                                }
                                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                    eprintln!(
                                        "[YunTuAI] OpenClaw absolute control timed out after {}s; continuing startup",
                                        ESTABLISH_TIMEOUT_SECS
                                    );
                                }
                                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                    eprintln!("[YunTuAI] OpenClaw absolute control thread exited early");
                                }
                            }
                        });
                        if let Err(panic) = result {
                            let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                                s.to_string()
                            } else if let Some(s) = panic.downcast_ref::<String>() {
                                s.clone()
                            } else {
                                "unknown panic".to_string()
                            };
                            eprintln!("[YunTuAI CRASH] establish thread panic: {msg}");
                        }
                        // 即使失败也放行 auto-ensure，避免永远等不到网关
                        openclaw_control::mark_establish_complete();
                    }) {
                    Ok(handle) => gateway_supervisor::register_daemon_handle(handle),
                    Err(e) => {
                        eprintln!("[YunTuAI] establish thread spawn failed: {e}");
                        openclaw_control::mark_establish_complete();
                    }
                }
            } else {
                openclaw_control::mark_establish_complete();
            }
            log_startup_phase("setup: opening database");
            // 数据库初始化在后台线程执行，避免 SQLite WAL 回放等慢操作阻塞主线程/窗口创建。
            // 客户机杀毒扫描 / 升级回收大库时 30s 不够；备份已改后台，关键路径仍可能慢。
            let db_init_timeout_secs = if cfg!(debug_assertions) { 90 } else { 60 };
            let (db_tx, db_rx) = std::sync::mpsc::channel();
            std::thread::Builder::new()
                .name("yuntuai-db-init".into())
                .spawn(move || {
                    let result = init_db();
                    if db_tx.send(result).is_err() {
                        eprintln!("[YunTuAI DB] init_db: result not delivered (setup timed out or exited)");
                    }
                })
                .expect("spawn db init thread");
            let conn = match db_rx.recv_timeout(std::time::Duration::from_secs(db_init_timeout_secs)) {
                Ok(Ok(c)) => c,
                Ok(Err(e)) => return Err(format!("数据库初始化失败: {e}").into()),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "数据库初始化超时（{db_init_timeout_secs}s）。请完全退出 YunTuAI / tauri-app 后重试；\
                         若仍失败，备份并删除数据目录下的 data 文件夹（开发版常见路径：\
                         %LOCALAPPDATA%\\YunTuAI\\data 或 %APPDATA%\\YunTuAI\\data）"
                    )
                    .into());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(
                        "数据库初始化线程异常退出。请查看终端中 [YunTuAI DB] 日志；\
                         若有其它 YunTuAI 实例占用数据库，请先结束进程后重试。"
                            .into(),
                    );
                }
            };
            let db_conn = Arc::new(Mutex::new(conn));
            spawn_durable_account_backup(Arc::clone(&db_conn));
            app.manage(DbState { conn: db_conn });
            {
                let db = app.state::<DbState>();
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                let _ = app_upgrade::reconcile_on_startup(&conn);
            }
            log_startup_phase("setup: db ready");
            let sup = GatewaySupervisor::default();
            app.manage(sup);
            app.manage(MeetingSupervisor::default());
            start_exclusive_report_emitter(app.handle().clone());
            start_supervisor_health_watch(app.handle().clone());
            log_startup_phase("setup: gateway supervisor started");

            // 应用启动后自动接管网关（不依赖前端登录），避免孤儿进程导致连接失败。
            {
                let app_handle = app.handle().clone();
                if let Ok(handle) = std::thread::Builder::new()
                    .name("yuntuai-gateway-auto-ensure".into())
                    .spawn(move || {
                        // 让桌面窗口先完成首帧绘制，再跑重型网关治理，避免「点开就整窗卡死」。
                        // 登录自启时系统刚开机，适当延长等待，避免网关/node 抢资源失败。
                        let delay_ms = app_launch::auto_ensure_initial_delay_ms();
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        let establish_wait = if app_handle
                            .try_state::<GatewaySupervisor>()
                            .map(|sup| sup.is_operational_fast())
                            .unwrap_or(false)
                            || openclaw_control::is_establish_complete()
                        {
                            log_startup_phase(
                                "auto-ensure: warm gateway, shorten establish wait",
                            );
                            std::time::Duration::from_secs(5)
                        } else {
                            app_launch::establish_wait_timeout()
                        };
                        openclaw_control::wait_for_establish_ready(establish_wait);
                        if crate::license::assert_licensed().is_err() {
                            log_startup_phase("auto-ensure gateway skipped: device not licensed");
                            return;
                        }
                        if let Ok(st) = crate::openclaw_env::env_status() {
                            if st.setup_required {
                                log_startup_phase(
                                    "auto-ensure gateway skipped: model API key not configured",
                                );
                                return;
                            }
                        }
                        let _ = crate::openclaw_relay_waf_patch::ensure_portable_relay_waf_patch();
                        crate::openclaw_env::poke_relay_gateway_env_reload_on_startup();
                        let _ = crate::service_config_repair::repair_service_config(false);
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            if let (Some(sup), Some(db)) = (
                                app_handle.try_state::<GatewaySupervisor>(),
                                app_handle.try_state::<DbState>(),
                            ) {
                                let run_ensure = |label: &str| -> Option<gateway_supervisor::GatewaySupervisorStatus> {
                                    if sup.is_operational_fast() {
                                        if let Some(Ok(st)) = sup.try_ensure_running(&db) {
                                            let line = format!(
                                                "auto-ensure gateway ({label} fast): supervised={} running={} health_ok={}",
                                                st.supervised, st.running, st.health_ok
                                            );
                                            eprintln!("[YunTuAI] {line}");
                                            log_startup_phase(&line);
                                            push_exclusive_report(&app_handle, &sup);
                                            return Some(st);
                                        }
                                    }
                                    match sup.ensure_running(&db) {
                                        Ok(st) => {
                                            let line = format!(
                                                "auto-ensure gateway ({label}): supervised={} running={} health_ok={} msg={}",
                                                st.supervised, st.running, st.health_ok, st.message
                                            );
                                            eprintln!("[YunTuAI] {line}");
                                            log_startup_phase(&line);
                                            push_exclusive_report(&app_handle, &sup);
                                            Some(st)
                                        }
                                        Err(e) => {
                                            let user_msg =
                                                crate::user_facing_copy::sanitize_user_facing_copy(&e);
                                            let line = format!(
                                                "auto-ensure gateway ({label}) failed: {user_msg}"
                                            );
                                            eprintln!("[YunTuAI] {line}");
                                            log_startup_phase(&line);
                                            None
                                        }
                                    }
                                };

                                if let Some(st) = run_ensure("initial") {
                                    if app_launch::should_retry_auto_ensure(st.health_ok, st.running) {
                                        let wait = app_launch::auto_ensure_retry_delay();
                                        log_startup_phase(&format!(
                                            "auto-ensure: gateway not healthy, retry after {}ms",
                                            wait.as_millis()
                                        ));
                                        std::thread::sleep(wait);
                                        let _ = run_ensure("retry");
                                    }
                                } else {
                                    let mut retried = false;
                                    if let Ok(repair) =
                                        crate::service_config_repair::repair_service_config(false)
                                    {
                                        if repair.changed {
                                            log_startup_phase(
                                                "auto-ensure: repaired service config, retrying gateway",
                                            );
                                            let _ = run_ensure("post-repair");
                                            retried = true;
                                        }
                                    }
                                    if !retried
                                        && crate::openclaw_control::sync_model_providers_for_dotenv()
                                            .unwrap_or(false)
                                    {
                                        log_startup_phase(
                                            "auto-ensure: synced optional providers, retrying gateway",
                                        );
                                        let _ = run_ensure("post-sync");
                                        retried = true;
                                    }
                                    if !retried && app_launch::is_fresh_system_boot() {
                                        let wait = app_launch::auto_ensure_retry_delay();
                                        log_startup_phase(&format!(
                                            "auto-ensure: fresh boot retry after {}ms",
                                            wait.as_millis()
                                        ));
                                        std::thread::sleep(wait);
                                        let _ = run_ensure("retry");
                                    }
                                }
                            }
                        }));
                    })
                {
                    crate::gateway_supervisor::register_daemon_handle(handle);
                }
            }

            if openclaw_provision::needs_provision()
                && !openclaw_runtime::choice_required()
                && crate::license::assert_licensed().is_ok()
            {
                openclaw_provision::start_provision_async(app.handle().clone(), provision, None, false);
            }
            log_startup_phase("setup: all done — entering event loop");
            Ok(())
        })();
        if let Err(e) = &result {
            let msg = format!("[YunTuAI SETUP ERROR] {e}");
            eprintln!("{msg}");
            log_startup_phase(&format!("SETUP ERROR: {msg}"));
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    let log = dir.join("yuntuai-crash.log");
                    append_diagnostic_log(
                        &log,
                        &format!(
                            "=== {} SETUP ERROR ===\n{msg}",
                            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
                        ),
                    );
                }
            }
        }
        log_startup_phase(if result.is_ok() { "run: setup ok" } else { "run: setup failed" });
        result
    })
        .invoke_handler(tauri::generate_handler![
            openclaw_dir_status,
            get_gateway_connect_credentials,
            openclaw_gateway_health_json,
            openclaw_gateway_start,
            openclaw_gateway_stop,
            openclaw_stop_all_gateways,
            openclaw_suppress_external,
            openclaw_gateway_restart,
            gateway_supervisor_status,
            gateway_supervisor_ensure,
            gateway_supervisor_stop,
            gateway_supervisor_restart,
            gateway_supervisor_reclaim,
            gateway_lifecycle_snapshot,
            gateway_service_diagnostic_snapshot,
            gateway_supervisor_request_recovery,
            gateway_event_persist_batch,
            gateway_events_list,
            openclaw_exclusive_report,
            openclaw_control_discover,
            openclaw_control_adopt,
            openclaw_control_read_config,
            openclaw_control_write_config,
            openclaw_control_enforce,
            openclaw_control_ai_access_status,
            openclaw_control_ai_access_set,
            openclaw_establish_absolute_control,
            openclaw_migrate_from_legacy,
            chat_get_output_dir,
            chat_set_output_dir,
            chat_pick_output_folder,
            chat_save_upload_files,
            chat_inspect_dropped_paths,
            chat_save_upload_paths,
            chat_read_file_base64,
            chat_read_text_preview,
            chat_extract_office_context,
            chat_ocr_image_paths,
            chat_write_office_output,
            chat_open_file,
            openclaw_scan_data_roots_cmd,
            openclaw_switch_data_root_cmd,
            reveal_path_in_os_cmd,
            chat_scan_new_output_files,
            openclaw_read_mcp_servers,
            openclaw_provision_status,
            openclaw_provision_start,
            openclaw_bootstrap_curated_skills,
            openclaw_touch_skills_watch,
            kb_assistant_status_cmd,
            kb_assistant_enable_cmd,
            kb_assistant_disable_cmd,
            kb_assistant_save_config_cmd,
            kb_assistant_probe_health_cmd,
            skill_studio_install_draft,
            skill_studio_install_community,
            skill_studio_list_bundled_community,
            skill_studio_list_installed,
            loop_engineering_status_cmd,
            openclaw_runtime_set,
            openclaw_runtime_switch,
            openclaw_env_status_cmd,
            openclaw_resync_relay_api_key_cmd,
            openclaw_distribution_profile_cmd,
            app_launch::yuntuai_launch_context,
            app_upgrade::yuntuai_consume_upgrade_notice,
            openclaw_env_save_keys_cmd,
            openclaw_env_set_model,
            openclaw_env_get_model,
            openclaw_env_list_models,
            llm_user_list_presets,
            llm_user_list_slots,
            llm_user_save_slot,
            llm_user_clear_slot,
            openclaw_gateway_memory_limit,
            openclaw_gateway_memory_limit_save,
            db_list_sessions,
            db_create_session,
            db_delete_session,
            db_append_message,
            db_delete_message,
            db_collapse_replayed_messages,
            db_list_messages,
            db_clear_session_messages,
            db_set_remote_session_key,
            db_set_session_agent,
            db_update_session_title,
            db_create_task,
            db_list_tasks,
            db_update_task_status,
            db_get_task,
            audit_list,
            audit_append_event,
            audit_export_json,
            db_check_integrity,
            db_run_maintenance,
            db_try_autobackup,
            auth_register,
            auth_login,
            auth_owner_emergency_login,
            auth_logout,
            auth_resume_session,
            auth_change_password,
            auth_admin_reset_password,
            auth_delete_user,
            auth_set_user_role,
            auth_cleanup_expired_tokens,
            auth_list_users,
            auth_has_users,
            auth_gate_status,
            auth_dev_skip_login,
            auth_dev_auto_login,
            owner_login,
            owner_emergency_login_enabled_cmd,
            owner_logout,
            owner_session_status_cmd,
            module_list,
            module_install,
            module_uninstall,
            module_set_enabled,
            module_get_config,
            module_save_config,
            module_validate_manifest,
            module_scan_dir,
            check_license,
            activate_license,
            generate_license_content,
            install_license,
            image_gen_test_connection_cmd,
            image_gen_config_cmd,
            image_gen_save_config_cmd,
            image_gen_use_chat_api_key_cmd,
            image_gen_create_cmd,
            image_gen_pick_references_cmd,
            image_gen_list_cmd,
            image_gen_delete_cmd,
            image_gen_export_cmd,
            image_gen_reveal_folder_cmd,
            meeting_create_session,
            meeting_list_sessions,
            meeting_get_live_state,
            meeting_load_older_segments,
            meeting_start_recording,
            meeting_push_segment,
            meeting_push_audio_chunk,
            meeting_transcribe_live_chunk,
            meeting_stop_recording,
            meeting_trigger_digest,
            meeting_update_session,
            meeting_update_segment,
            meeting_import_audio,
            meeting_transcribe_audio,
            meeting_export_docx,
            meeting_delete_session,
            app_check_update,
            app_install_msi_update,
            app_consume_update_failure_hint,
            app_system_info,
            yuntuai_run_diagnose_report,
            service_config_repair::yuntuai_repair_service_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
