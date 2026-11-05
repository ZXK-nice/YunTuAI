//! Whitelisted `openclaw` CLI invocations for gateway supervisor control.

use crate::auth::assert_authenticated_mutex;
use crate::db::DbState;
use crate::gateway_supervisor::GatewaySupervisor;
use crate::openclaw_control::{managed_openclaw_data_dir, read_sealed_gateway_token};
use crate::openclaw_exec::{run_openclaw, OpenClawCliResult};
use tauri::{AppHandle, Manager, State};

/// Helper to map a GatewaySupervisorStatus into the OpenClawCliResult shape.
fn supervisor_to_cli_result(st: &crate::gateway_supervisor::GatewaySupervisorStatus) -> OpenClawCliResult {
    OpenClawCliResult {
        ok: st.running,
        stdout: serde_json::to_string(st).unwrap_or_else(|_| st.message.clone()),
        stderr: String::new(),
        exit_code: if st.running { Some(0) } else { Some(1) },
    }
}

fn resolve_gateway_cli_token() -> Option<String> {
    if let Ok(dir) = managed_openclaw_data_dir() {
        if let Ok(raw) = std::fs::read_to_string(dir.join(".env")) {
            for line in raw.lines() {
                if let Some((k, v)) = line.split_once('=') {
                    if k.trim() == "OPENCLAW_GATEWAY_TOKEN" {
                        let t = v.trim();
                        if !t.is_empty() {
                            return Some(t.to_string());
                        }
                    }
                }
            }
        }
    }
    read_sealed_gateway_token()
}

#[tauri::command]
pub async fn openclaw_gateway_health_json(
    state: State<'_, DbState>,
    token: String,
    url: Option<String>,
) -> Result<OpenClawCliResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let r = match url {
            Some(u) if !u.trim().is_empty() => {
                let u = u.trim().to_string();
                let gw_token = resolve_gateway_cli_token();
                if let Some(t) = gw_token {
                    run_openclaw(&[
                        "gateway",
                        "health",
                        "--json",
                        "--url",
                        &u,
                        "--token",
                        t.as_str(),
                    ])
                } else {
                    run_openclaw(&["gateway", "health", "--json", "--url", &u])
                }
            }
            _ => run_openclaw(&["gateway", "health", "--json"]),
        };
        r
    })
    .await
}

#[tauri::command]
pub async fn openclaw_gateway_start(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawCliResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        assert_authenticated_mutex(&conn, &token)?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();
        let st = sup.ensure_running_nonblocking(&app, &db)?;
        Ok(supervisor_to_cli_result(&st))
    })
    .await
}

#[tauri::command]
pub async fn openclaw_gateway_stop(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawCliResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        assert_authenticated_mutex(&conn, &token)?;
        let db = app.state::<DbState>();
        let st = app.state::<GatewaySupervisor>().stop(&db)?;
        Ok(supervisor_to_cli_result(&st))
    })
    .await
}

#[tauri::command]
pub async fn openclaw_gateway_restart(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawCliResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        assert_authenticated_mutex(&conn, &token)?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();
        let st = sup.restart_nonblocking(&app, &db)?;
        Ok(supervisor_to_cli_result(&st))
    })
    .await
}

#[tauri::command]
pub async fn openclaw_stop_all_gateways(
    state: State<'_, DbState>,
    token: String,
) -> Result<(), String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        assert_authenticated_mutex(&conn, &token)?;
        std::thread::Builder::new()
            .name("yuntuai-stop-all-gw".into())
            .spawn(|| {
                crate::openclaw_exec::stop_all_gateways();
            })
            .map_err(|e| format!("spawn stop_all_gateways: {e}"))?;
        Ok(())
    })
    .await
}

/// 仅关闭外部（PATH/计划任务）OpenClaw 网关，不杀 YunTuAI 内置监管实例。
#[tauri::command]
pub async fn openclaw_suppress_external(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<(), String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        assert_authenticated_mutex(&conn, &token)?;
        let sup = app.state::<GatewaySupervisor>();
        if sup.is_operational_fast() {
            return Ok(());
        }
        let protect = sup.status().ok().and_then(|st| st.pid);
        std::thread::Builder::new()
            .name("yuntuai-suppress-ext".into())
            .spawn(move || {
                crate::openclaw_exec::suppress_external_openclaw(protect);
            })
            .map_err(|e| format!("spawn suppress_external: {e}"))?;
        Ok(())
    })
    .await
}
