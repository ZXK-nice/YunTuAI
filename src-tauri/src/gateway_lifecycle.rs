//! 本机服务生命周期状态 — 前端就绪/恢复/诊断的单一真相源。

use crate::db::{audit_insert_on_conn, gateway_event_insert_batch_on_conn, gateway_events_list_on_conn, lock_conn, DbState, GatewayEventRow};
use crate::gateway_supervisor::{
    emit_exclusive_report, GatewaySupervisor, GatewaySupervisorStatus, OpenClawExclusiveReport,
};
use crate::openclaw_control::is_establish_complete;
use crate::openclaw_control::is_establish_work_active;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GatewayLifecyclePhase {
    Preparing,
    Starting,
    Healthy,
    Degraded,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayLifecycleSnapshot {
    pub phase: GatewayLifecyclePhase,
    pub detail: String,
    pub at: String,
    pub establish_complete: bool,
    /// establish 工作线程仍在跑（超时放行后也可能为 true，前端应推迟重型 IPC）
    pub establish_work_active: bool,
    pub process_alive: bool,
    pub port_reachable: bool,
    /// WS health RPC 无响应但进程仍存活（长任务/假死区分）
    pub process_busy_likely: bool,
    pub ws_connect_suggested: bool,
    pub external_conflict: bool,
    pub bundled_ready: bool,
    pub supervisor: GatewaySupervisorStatus,
}

pub fn build_lifecycle_snapshot(sup: &GatewaySupervisor) -> Result<GatewayLifecycleSnapshot, String> {
    let report = sup.exclusive_report(false)?;
    Ok(build_from_report(&report))
}

fn build_from_report(report: &OpenClawExclusiveReport) -> GatewayLifecycleSnapshot {
    let establish_complete = is_establish_complete();
    let establish_work_active = is_establish_work_active();
    let bundled_ready = report.bundled_ready;
    let supervisor = report.supervisor.clone();
    let process_alive = supervisor.running && supervisor.supervised;
    let port_reachable = report.port_reachable;
    let external_conflict = report.external_gateway_conflict;
    let needs_provision = crate::openclaw_provision::needs_provision();

    let phase = if !establish_complete || needs_provision || (!bundled_ready && !process_alive) {
        GatewayLifecyclePhase::Preparing
    } else if external_conflict {
        GatewayLifecyclePhase::Degraded
    } else if process_alive && supervisor.health_ok {
        GatewayLifecyclePhase::Healthy
    } else if (process_alive && port_reachable) || (port_reachable && !process_alive) {
        GatewayLifecyclePhase::Degraded
    } else if process_alive {
        GatewayLifecyclePhase::Starting
    } else if crate::user_facing_copy::looks_like_actionable_gateway_startup_failure(
        &supervisor.message,
    ) || supervisor.supervised {
        GatewayLifecyclePhase::Failed
    } else {
        GatewayLifecyclePhase::Starting
    };

    let detail = match &phase {
        GatewayLifecyclePhase::Preparing => "正在准备本机服务环境…".into(),
        GatewayLifecyclePhase::Starting => "正在启动本机服务…".into(),
        GatewayLifecyclePhase::Healthy => "本机服务运行正常".into(),
        GatewayLifecyclePhase::Degraded => {
            if external_conflict {
                "检测到外部进程占用服务端口，正在回收…".into()
            } else if process_alive && !supervisor.health_ok {
                "本机服务进程在运行，健康检查暂未通过…".into()
            } else {
                "本机服务响应异常，正在恢复…".into()
            }
        }
        GatewayLifecyclePhase::Failed => {
            if supervisor.message.trim().is_empty() {
                "本机服务启动失败".into()
            } else {
                supervisor.message.clone()
            }
        }
    };

    let process_busy_likely =
        process_alive && port_reachable && !supervisor.health_ok && !external_conflict;

    let ws_connect_suggested = port_reachable
        && !external_conflict
        && establish_complete
        && bundled_ready
        && (matches!(
            phase,
            GatewayLifecyclePhase::Healthy | GatewayLifecyclePhase::Degraded | GatewayLifecyclePhase::Starting
        ) || process_alive);

    GatewayLifecycleSnapshot {
        phase,
        detail,
        at: Utc::now().to_rfc3339(),
        establish_complete,
        establish_work_active,
        process_alive,
        port_reachable,
        process_busy_likely,
        ws_connect_suggested,
        external_conflict,
        bundled_ready,
        supervisor,
    }
}

pub fn emit_lifecycle_from_report(app: &AppHandle, report: &OpenClawExclusiveReport) {
    let snapshot = build_from_report(report);
    let _ = app.emit("gateway-lifecycle-state", &snapshot);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayServiceDiagnosticSnapshot {
    pub lifecycle: GatewayLifecycleSnapshot,
    pub data_dir: Option<String>,
    pub listen_port: u16,
    pub provision_needed: bool,
    pub runtime_available: bool,
}

#[tauri::command]
pub async fn gateway_lifecycle_snapshot(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewayLifecycleSnapshot, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        build_lifecycle_snapshot(&sup)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gateway_service_diagnostic_snapshot(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewayServiceDiagnosticSnapshot, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        let lifecycle = build_lifecycle_snapshot(&sup)?;
        let data_dir = crate::openclaw_control::managed_openclaw_data_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        let listen_port = crate::openclaw::read_gateway_listen_endpoint()
            .map(|(_, p)| p)
            .unwrap_or(18789);
        Ok(GatewayServiceDiagnosticSnapshot {
            lifecycle,
            data_dir,
            listen_port,
            provision_needed: crate::openclaw_provision::needs_provision(),
            runtime_available: crate::openclaw_provision::is_openclaw_available(),
        })
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRecoveryResult {
    pub ok: bool,
    pub method: String,
    pub message: String,
    pub lifecycle: GatewayLifecycleSnapshot,
}

/// 前端断连/stall 时统一走 Rust 恢复，避免多处 ensure/restart 竞态。
#[tauri::command]
pub async fn gateway_supervisor_request_recovery(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewayRecoveryResult, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();

        let mut method = "none".to_string();
        let mut message = String::new();

        let report_before = sup.exclusive_report(true)?;
        if report_before.external_gateway_conflict {
            crate::openclaw::stop_all_external_gateways();
            method = "reclaim".into();
            sup.reclaim_exclusive()?;
            message.push_str("已回收端口控制权；");
        }

        let status = sup.status()?;
        let port_up = crate::openclaw::gateway_port_reachable();
        let recovered = if status.running && status.health_ok {
            method = if method.is_empty() {
                "already_healthy".into()
            } else {
                method
            };
            true
        } else if status.running && status.supervised && port_up {
            method = if method.is_empty() {
                "defer_health".into()
            } else {
                method
            };
            if message.is_empty() {
                message = "本机服务端口可达，跳过重启，等待 WebSocket 连接…".into();
            }
            true
        } else if status.running {
            method = if method == "reclaim" {
                "reclaim_restart".into()
            } else {
                "restart".into()
            };
            let st = sup.restart_nonblocking(&app, &db)?;
            message.push_str(&st.message);
            st.running && (st.health_ok || sup.is_operational_fast())
        } else {
            method = if method.is_empty() {
                "ensure".into()
            } else {
                method
            };
            let st = sup.ensure_running_nonblocking(&app, &db)?;
            message.push_str(&st.message);
            st.running && (st.health_ok || sup.is_operational_fast())
        };

        {
            let c = lock_conn(&conn);
            let _ = audit_insert_on_conn(
                &c,
                "gateway",
                "supervisor_request_recovery",
                &format!("method={method} ok={recovered}"),
            );
        }

        emit_exclusive_report(&app, &sup);
        let lifecycle = build_lifecycle_snapshot(&sup)?;

        Ok(GatewayRecoveryResult {
            ok: recovered && !lifecycle.external_conflict,
            method,
            message: if message.trim().is_empty() {
                lifecycle.detail.clone()
            } else {
                message.trim().to_string()
            },
            lifecycle,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayEventInsertRow {
    pub id: String,
    pub session_id: Option<String>,
    pub session_key: Option<String>,
    pub message_id: Option<String>,
    pub send_id: Option<String>,
    pub event_name: String,
    pub payload_json: String,
    pub created_at: String,
}

#[tauri::command]
pub async fn gateway_event_persist_batch(
    state: State<'_, DbState>,
    token: String,
    rows: Vec<GatewayEventInsertRow>,
) -> Result<u64, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let c = lock_conn(&conn);
        gateway_event_insert_batch_on_conn(&c, &rows)
    })
    .await
}

#[tauri::command]
pub async fn gateway_events_list(
    state: State<'_, DbState>,
    token: String,
    session_id: Option<String>,
    send_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<GatewayEventRow>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let c = lock_conn(&conn);
        gateway_events_list_on_conn(
            &c,
            session_id.as_deref(),
            send_id.as_deref(),
            limit.unwrap_or(120),
        )
    })
    .await
}
