//! YunTuAI 对 OpenClaw Gateway 的独占监管：子进程由本应用拉起/终止，禁止旁路 daemon。

use crate::app_shutdown::{is_app_shutting_down, signal_app_shutdown};
use crate::db::{audit_insert_on_conn, lock_conn, DbState};
use crate::openclaw_exec::{
    build_openclaw_gateway_foreground_command, force_kill_port_owner,
    kill_orphan_openclaw_processes, port_listening_pid, run_openclaw_timed,
    stop_all_gateways,
};
use serde::Serialize;
use std::io::Read;
use std::process::{Child, ChildStderr};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const STARTUP_WAIT_MS: u64 = 250;
const HEALTH_POLL_MS: u64 = 200;
/// 冷启动时 Node 加载完才听端口。5s 会在监听前杀掉进程，测试机每次重连都失败。
/// 端口一旦可达立即返回，热启动不会多等。45s = 225 * 200ms。
const HEALTH_POLL_ROUNDS: u32 = 225;
/** 监管报告推送间隔，从 90s 缩短为 45s 后再放宽到 120s，减少设置页频繁 re-render。 */
const REPORT_EMIT_INTERVAL_SECS: u64 = 120;
const SPAWN_MAX_RETRIES: u32 = 3;
const SPAWN_RETRY_DELAY_MS: u64 = 800;
static ENSURE_BG_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static ENSURE_CONSECUTIVE_FAILURES: AtomicU32 = AtomicU32::new(0);
static ENSURE_BACKOFF_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
const ENSURE_BACKOFF_BASE_SECS: u64 = 120;
const ENSURE_BACKOFF_MAX_SECS: u64 = 900;

struct EnsureBgGuard;

impl Drop for EnsureBgGuard {
    fn drop(&mut self) {
        ENSURE_BG_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

fn ensure_backoff_active() -> bool {
    let Ok(guard) = ENSURE_BACKOFF_UNTIL.lock() else {
        return false;
    };
    guard
        .map(|until| Instant::now() < until)
        .unwrap_or(false)
}

fn bump_ensure_backoff() {
    let n = ENSURE_CONSECUTIVE_FAILURES.fetch_add(1, Ordering::SeqCst) + 1;
    let shift = n.saturating_sub(1).min(3);
    let delay = (ENSURE_BACKOFF_BASE_SECS << shift).min(ENSURE_BACKOFF_MAX_SECS);
    if let Ok(mut guard) = ENSURE_BACKOFF_UNTIL.lock() {
        *guard = Some(Instant::now() + Duration::from_secs(delay));
    }
}

fn clear_ensure_backoff() {
    ENSURE_CONSECUTIVE_FAILURES.store(0, Ordering::SeqCst);
    if let Ok(mut guard) = ENSURE_BACKOFF_UNTIL.lock() {
        *guard = None;
    }
}

fn try_ensure_with_backoff(app: &AppHandle) {
    if ensure_backoff_active() {
        return;
    }
    let Some(sup) = app.try_state::<GatewaySupervisor>() else {
        return;
    };
    let Some(db) = app.try_state::<DbState>() else {
        return;
    };
    match sup.try_ensure_running(&db) {
        Some(Ok(_)) => {
            clear_ensure_backoff();
            emit_exclusive_report(app, &sup);
        }
        Some(Err(_)) => bump_ensure_backoff(),
        None => {}
    }
}

/// 重型 PATH/legacy 探测缓存，避免每 45–90s 重复 spawn。
struct HeavyProbeCache {
    at: Instant,
    global_in_path: bool,
    global_version: Option<String>,
    legacy_exists: bool,
    legacy_dir: Option<String>,
}

static HEAVY_PROBE_CACHE: Mutex<Option<HeavyProbeCache>> = Mutex::new(None);
static HEAVY_PROBE_REFRESH_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
const HEAVY_PROBE_TTL: Duration = Duration::from_secs(300);

static REPORT_EMITTER_STARTED: AtomicBool = AtomicBool::new(false);
static HEALTH_WATCH_STARTED: AtomicBool = AtomicBool::new(false);

/// Daemon thread handles captured so shutdown_on_app_exit() can join them cleanly.
static DAEMON_HANDLES: Mutex<Vec<std::thread::JoinHandle<()>>> = Mutex::new(Vec::new());

/// `establish_absolute_control` 工作线程：超时后外层返回，内层仍可能在跑，必须可 join。
static ESTABLISH_WORK_HANDLE: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);

/// 将后台线程纳入退出 join 列表（establish / report / health-watch 等）。
pub fn register_daemon_handle(handle: std::thread::JoinHandle<()>) {
    if let Ok(mut guards) = DAEMON_HANDLES.lock() {
        guards.push(handle);
    }
}

/// 保存 establish 工作线程；若已有未回收句柄，并入 DAEMON_HANDLES。
pub fn register_establish_work_handle(handle: std::thread::JoinHandle<()>) {
    let prev = match ESTABLISH_WORK_HANDLE.lock() {
        Ok(mut slot) => slot.replace(handle),
        Err(poisoned) => poisoned.into_inner().replace(handle),
    };
    if let Some(prev) = prev {
        register_daemon_handle(prev);
    }
}

/// 退出路径限时 join establish 工作线程，避免无限卡住托盘退出。
pub fn join_establish_work_timeout(timeout: Duration) {
    let handle = match ESTABLISH_WORK_HANDLE.lock() {
        Ok(mut slot) => slot.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    };
    let Some(handle) = handle else {
        return;
    };
    let (tx, rx) = std::sync::mpsc::channel();
    match std::thread::Builder::new()
        .name("yuntuai-establish-join".into())
        .spawn(move || {
            let _ = handle.join();
            let _ = tx.send(());
        }) {
        Ok(_) => {
            if rx.recv_timeout(timeout).is_err() {
                eprintln!(
                    "[YunTuAI] establish work join timed out after {}ms",
                    timeout.as_millis()
                );
            }
        }
        Err(e) => {
            eprintln!("[YunTuAI] establish join thread spawn failed: {e}");
        }
    }
}

/// 全局单飞：防止 auto-ensure / 前端重连 / report emitter 并发 ensure 互杀子进程。
static ENSURE_SINGLE_FLIGHT: Mutex<()> = Mutex::new(());

/** 健康看门狗检查间隔：TCP 端口探针极轻量（800ms 超时），无需长间隔。
 * 10s 间隔 + 3 次连续失败 = 30s 触发恢复，相比旧的 6 分钟显著减少前端断连时间。
 * 仅连续 3 次端口不可达（而非 HTTP 繁忙）才判定网关死亡，避免误杀。 */
const HEALTH_WATCH_INTERVAL_SECS: u64 = 10;
const HEALTH_WATCH_FAILS_BEFORE_KILL: u32 = 3;

fn lock_supervisor(inner: &Mutex<SupervisorInner>) -> MutexGuard<'_, SupervisorInner> {
    inner.lock().unwrap_or_else(|e| e.into_inner())
}

pub(crate) fn emit_exclusive_report(app: &AppHandle, sup: &GatewaySupervisor) {
    if let Ok(report) = sup.exclusive_report(false) {
        let _ = app.emit("gateway-exclusive-report", &report);
        crate::gateway_lifecycle::emit_lifecycle_from_report(app, &report);
    }
}

/// 主动向前端推送一次监管报告（如 auto-ensure 完成后），减少启动轮询。
pub fn push_exclusive_report(app: &AppHandle, sup: &GatewaySupervisor) {
    emit_exclusive_report(app, sup);
}

/// 后台推送监管报告，前端监听 `gateway-exclusive-report` 事件，减少轮询 RPC。
/// 同时具备自愈能力：若检测到网关子进程已死亡，自动调用 ensure_running 拉起。
pub fn start_exclusive_report_emitter(app: AppHandle) {
    if REPORT_EMITTER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    match std::thread::Builder::new()
        .name("yuntuai-gateway-report-emit".into())
        .spawn(move || {
            // 首轮略等 auto-ensure 回收孤儿网关；1.5s 足够且比原 4s 更快让前端收到 gateway-exclusive-report。
            std::thread::sleep(Duration::from_millis(1500));
            loop {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if let Some(sup) = app.try_state::<GatewaySupervisor>() {
                    // 先检查网关存活状态；若已死且之前是监管状态，立即自愈拉起
                    if let Ok(status) = sup.status() {
                        let was_supervised = status.supervised;
                        if !status.running && was_supervised {
                            eprintln!(
                                "[YunTuAI] report-emitter: gateway child died (was supervised), auto-restarting..."
                            );
                            if let Some(db) = app.try_state::<crate::db::DbState>() {
                                if !ensure_backoff_active() {
                                    if let Some(sup) = app.try_state::<GatewaySupervisor>() {
                                        match sup.try_ensure_running(&db) {
                                            Some(Ok(_)) => clear_ensure_backoff(),
                                            Some(Err(_)) => bump_ensure_backoff(),
                                            None => {}
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // 端口有孤儿网关时先尝试 ensure/reclaim，再推送报告，减少前端误报。
                    if let Ok(report) = sup.exclusive_report(false) {
                        if report.external_gateway_conflict {
                            if let Some(db) = app.try_state::<crate::db::DbState>() {
                                if !ensure_backoff_active() {
                                    if let Some(sup) = app.try_state::<GatewaySupervisor>() {
                                        match sup.try_ensure_running(&db) {
                                            Some(Ok(_)) => clear_ensure_backoff(),
                                            Some(Err(_)) => bump_ensure_backoff(),
                                            None => {}
                                        }
                                    }
                                }
                            }
                        }
                    }
                    emit_exclusive_report(&app, &sup);
                }
            }));
            if let Err(panic) = result {
                let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "unknown panic".to_string()
                };
                eprintln!("[yuntuai CRASH] report emitter thread panic: {msg}");
            }
            if is_app_shutting_down() {
                break;
            }
            std::thread::sleep(Duration::from_secs(REPORT_EMIT_INTERVAL_SECS));
        }
        }) {
        Ok(handle) => {
            if let Ok(mut guards) = DAEMON_HANDLES.lock() {
                guards.push(handle);
            }
        }
        Err(e) => {
            eprintln!("[yuntuai] gateway report emitter thread failed: {e}");
        }
    }
}

/// 监管子进程存活 + 端口可达性巡检；连续失败则清理僵尸子进程。
pub fn start_supervisor_health_watch(app: AppHandle) {
    if HEALTH_WATCH_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    match std::thread::Builder::new()
        .name("yuntuai-gateway-health-watch".into())
        .spawn(move || {
            let mut fail_streak: u32 = 0;
            loop {
                if is_app_shutting_down() {
                    break;
                }
                std::thread::sleep(Duration::from_secs(HEALTH_WATCH_INTERVAL_SECS));
                if is_app_shutting_down() {
                    break;
                }
                let tick_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if let Some(sup) = app.try_state::<GatewaySupervisor>() {
                        sup.tick_health_watch()
                    } else {
                        Ok(true)
                    }
                }));
                match tick_result {
                    Ok(Ok(true)) => fail_streak = 0,
                    Ok(Ok(false)) => {
                        fail_streak += 1;
                        if health_watch_should_emit_unhealthy(fail_streak) {
                            try_ensure_with_backoff(&app);
                            let recovered = app
                                .try_state::<GatewaySupervisor>()
                                .map(|sup| sup.is_operational_fast())
                                .unwrap_or(false);
                            if recovered {
                                fail_streak = 0;
                            }
                            if !recovered {
                                let _ = app.emit("gateway-supervisor-unhealthy", ());
                            }
                        }
                    }
                    Ok(Err(_)) => {}
                    Err(panic) => {
                        let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                            s.to_string()
                        } else if let Some(s) = panic.downcast_ref::<String>() {
                            s.clone()
                        } else {
                            "unknown panic".to_string()
                        };
                        eprintln!("[yuntuai CRASH] health watch thread panic: {msg}");
                    }
                }
            }
        }) {
        Ok(handle) => {
            if let Ok(mut guards) = DAEMON_HANDLES.lock() {
                guards.push(handle);
            }
        }
        Err(e) => {
            eprintln!("[yuntuai] gateway health watch thread failed: {e}");
        }
    }
}

pub struct GatewaySupervisor {
    inner: Mutex<SupervisorInner>,
}

struct SupervisorInner {
    child: Option<Child>,
    started_at: Option<Instant>,
    health_ok: bool,
    /// 最近一次 spawn/健康检查失败的可读原因（供前端快速展示，避免连接门傻等超时）。
    last_startup_error: Option<String>,
    /// 后台线程持续读取 stderr 管道，防止 pipe buffer 写满 → 子进程 block。
    /// 仅保留尾部 STDER_RING_SIZE 字节用于崩溃诊断。
    stderr_buf: Arc<Mutex<Vec<u8>>>,
    stderr_drainer: Option<std::thread::JoinHandle<()>>,
}

/// stderr 环形缓冲区上限（字节），覆盖 capture_child_stderr 的 512 字节截断。
const STDERR_RING_SIZE: usize = 4096;

impl Default for GatewaySupervisor {
    fn default() -> Self {
        Self {
            inner: Mutex::new(SupervisorInner {
                child: None,
                started_at: None,
                health_ok: false,
                last_startup_error: None,
                stderr_buf: Arc::new(Mutex::new(Vec::with_capacity(STDERR_RING_SIZE))),
                stderr_drainer: None,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewaySupervisorStatus {
    pub supervised: bool,
    pub pid: Option<u32>,
    pub running: bool,
    pub health_ok: bool,
    pub message: String,
}

fn build_openclaw_gateway_command() -> Result<std::process::Command, String> {
    build_openclaw_gateway_foreground_command()
}

/// 等待已 kill 的子进程退出，最多等待 `timeout`。超时后不再阻塞调用线程。
fn wait_child_timeout(child: &mut Child, timeout: Duration) {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => break,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
}

fn child_running(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) => false,
        Err(_) => false,
    }
}

/// 检查子进程是否存活；若已退出，返回 (false, exit_code)。
fn child_status(child: &mut Child) -> (bool, Option<i32>) {
    match child.try_wait() {
        Ok(None) => (true, None),
        Ok(Some(status)) => (false, status.code()),
        Err(_) => (false, None),
    }
}

fn health_ok_once() -> bool {
    crate::openclaw::gateway_health_ok()
}

/// spawn 等待期间必须绕过负面缓存，否则「端口曾为空」会导致新进程被误杀。
/// spawn 等待期间仅用 TCP 探针（端口绑定即就绪），不走 HTTP 3s 超时路径。
fn health_ok_for_spawn_wait() -> bool {
    crate::openclaw::gateway_port_reachable()
}

struct HeavyProbeRefreshGuard;
impl Drop for HeavyProbeRefreshGuard {
    fn drop(&mut self) {
        HEAVY_PROBE_REFRESH_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

fn spawn_heavy_probe_refresh() {
    if HEAVY_PROBE_REFRESH_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("yuntuai-heavy-probe".into())
        .spawn(|| {
            let _guard = HeavyProbeRefreshGuard;
            let _ = heavy_probes_compute();
        });
}

fn heavy_probes_compute() -> (bool, Option<String>, bool, Option<String>) {
    let (global_in_path, global_version) = crate::openclaw::probe_global_openclaw();
    let (legacy_exists, legacy_dir) = crate::openclaw::probe_legacy_home_openclaw();
    if let Ok(mut guard) = HEAVY_PROBE_CACHE.lock() {
        *guard = Some(HeavyProbeCache {
            at: Instant::now(),
            global_in_path,
            global_version: global_version.clone(),
            legacy_exists,
            legacy_dir: legacy_dir.clone(),
        });
    }
    (global_in_path, global_version, legacy_exists, legacy_dir)
}

/// 轻量报告禁止跑 `where openclaw` / `--version`（各最多 8s）。
/// 缓存未命中时立刻返回空值，后台补探测。
fn heavy_probes(refresh: bool) -> (bool, Option<String>, bool, Option<String>) {
    if !refresh {
        if let Ok(guard) = HEAVY_PROBE_CACHE.lock() {
            if let Some(c) = guard.as_ref() {
                let out = (
                    c.global_in_path,
                    c.global_version.clone(),
                    c.legacy_exists,
                    c.legacy_dir.clone(),
                );
                let expired = c.at.elapsed() >= HEAVY_PROBE_TTL;
                drop(guard);
                if expired {
                    spawn_heavy_probe_refresh();
                }
                return out;
            }
        }
        spawn_heavy_probe_refresh();
        return (false, None, false, None);
    }
    heavy_probes_compute()
}

/// 尝试 spawn 网关子进程，支持重试。
fn spawn_gateway_child_with_retry() -> Result<Child, String> {
    let mut last_err = String::new();
    for attempt in 0..SPAWN_MAX_RETRIES {
        let mut cmd = build_openclaw_gateway_command().map_err(|e| {
            // 命令构造失败（如 runtime 缺失）不重试
            format!("无法构建 gateway 命令: {e}")
        })?;
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => {
                last_err = format!("无法启动受监管的本机服务: {e}");
                if attempt + 1 < SPAWN_MAX_RETRIES {
                    std::thread::sleep(Duration::from_millis(SPAWN_RETRY_DELAY_MS));
                }
            }
        }
    }
    Err(last_err)
}

struct HealthyGatewayChild {
    child: Child,
    stderr_drainer: Option<std::thread::JoinHandle<()>>,
}

/// 等待子进程变为健康（端口可达）。
/// `stderr` 必须已交给 drainer，否则管道写满会把网关卡在听端口之前。
fn wait_for_gateway_health(
    child: &mut Child,
    stderr_buf: &Arc<Mutex<Vec<u8>>>,
) -> Result<(), String> {
    crate::openclaw::clear_gateway_health_cache();
    std::thread::sleep(Duration::from_millis(STARTUP_WAIT_MS));

    let (alive, code) = child_status(child);
    if !alive {
        let stderr = stderr_tail_from_buf(stderr_buf);
        return Err(crate::user_facing_copy::humanize_gateway_startup_error(
            &stderr,
            code,
        ));
    }

    for _ in 0..HEALTH_POLL_ROUNDS {
        if health_ok_for_spawn_wait() {
            return Ok(());
        }
        let (alive, code) = child_status(child);
        if !alive {
            let stderr = stderr_tail_from_buf(stderr_buf);
            return Err(crate::user_facing_copy::humanize_gateway_startup_error(
                &stderr,
                code,
            ));
        }
        std::thread::sleep(Duration::from_millis(HEALTH_POLL_MS));
    }

    let stderr = stderr_tail_from_buf(stderr_buf);
    let _ = child.kill();
    wait_child_timeout(child, Duration::from_secs(3));
    if stderr.is_empty() {
        Err("本机服务已启动但健康检查未通过（端口不可达）。请稍后在软件设置 → 本机服务中重试。".into())
    } else {
        eprintln!("[YunTuAI] gateway stderr (port not ready): {stderr}");
        Err(format!(
            "本机服务已启动但健康检查未通过（端口不可达）。{stderr}"
        ))
    }
}

/// 完整 spawn + health wait 流程，含重试；配置 schema 失败时自动修复一次。
fn spawn_and_await_healthy(
    stderr_buf: &Arc<Mutex<Vec<u8>>>,
) -> Result<HealthyGatewayChild, String> {
    match spawn_and_await_healthy_inner(stderr_buf) {
        Ok(child) => Ok(child),
        Err(e) => {
            if crate::service_config_repair::looks_like_config_schema_error(&e)
                || crate::service_config_repair::looks_like_gateway_secret_error(&e)
            {
                let _ = crate::openclaw_control::sync_model_providers_for_dotenv();
                if let Ok(repair) = crate::service_config_repair::repair_service_config(false) {
                    if repair.changed {
                        eprintln!("[YunTuAI] auto-repaired service config after gateway startup failure");
                        return spawn_and_await_healthy_inner(stderr_buf);
                    }
                }
            }
            Err(e)
        }
    }
}

fn spawn_and_await_healthy_inner(
    stderr_buf: &Arc<Mutex<Vec<u8>>>,
) -> Result<HealthyGatewayChild, String> {
    let mut last_err = String::new();
    for attempt in 0..SPAWN_MAX_RETRIES {
        if let Ok(mut buf) = stderr_buf.lock() {
            buf.clear();
        }
        let mut child = spawn_gateway_child_with_retry()?;
        // 健康检查结束前就要读 stderr。否则管道写满，网关卡在 listen 之前，端口永远不可达。
        let stderr_drainer = child.stderr.take().and_then(|stderr| {
            spawn_stderr_drainer(stderr, Arc::clone(stderr_buf))
        });
        // Protect this child immediately (before the multi-second health wait) so a racing
        // suppress/orphan-kill thread cannot tear it down while we wait for it to become healthy.
        crate::openclaw_exec::set_managed_gateway_pid(Some(child.id()));
        match wait_for_gateway_health(&mut child, stderr_buf) {
            Ok(()) => {
                return Ok(HealthyGatewayChild {
                    child,
                    stderr_drainer,
                });
            }
            Err(e) => {
                last_err = e;
                // This attempt failed — drop protection before we kill and retry.
                crate::openclaw_exec::set_managed_gateway_pid(None);
                let _ = child.kill();
                wait_child_timeout(&mut child, Duration::from_secs(3));
                drop(stderr_drainer);
                if attempt + 1 < SPAWN_MAX_RETRIES {
                    // 重试前做一次 gateway stop 清理残留端口
                    let _ = run_openclaw_timed(&["gateway", "stop"], Duration::from_secs(8));
                    std::thread::sleep(Duration::from_millis(SPAWN_RETRY_DELAY_MS));
                }
            }
        }
    }
    Err(last_err)
}

/// 端口被非监管进程占用（常见于本机 global openclaw + Machine 级 Token 污染）时强制回收。
/// 返回 true 表示已清理，调用方应视为配置过期并重新 spawn。
fn reconcile_gateway_port(inner: &mut SupervisorInner) -> bool {
    let port = crate::openclaw::read_gateway_listen_endpoint()
        .map(|(_, p)| p)
        .unwrap_or(18789);
    if !crate::openclaw::gateway_port_reachable() {
        return false;
    }
    let child_pid = if let Some(ref mut c) = inner.child {
        if child_running(c) {
            Some(c.id())
        } else {
            None
        }
    } else {
        None
    };
    let Some(owner) = port_listening_pid(port) else {
        return false;
    };
    if !port_owner_needs_reconcile(child_pid, owner) {
        return false;
    }
    // Windows 上监听 PID 经常是启动器拉起的 node，不等于 child.id()。
    // 监管子进程还活着就不要杀端口，否则会把正在服务的网关拆掉。
    if inner.child.as_mut().map(child_running).unwrap_or(false) {
        return false;
    }
    force_kill_port_owner(port);
    kill_orphan_openclaw_processes(child_pid);
    if inner.child.is_some() {
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            wait_child_timeout(&mut child, Duration::from_secs(3));
        }
        inner_clear(inner);
    }
    true
}

impl GatewaySupervisor {
    fn status_locked(inner: &mut SupervisorInner) -> GatewaySupervisorStatus {
        let mut running = false;
        let mut pid = None;
        if let Some(ref mut child) = inner.child {
            if child_running(child) {
                running = true;
                pid = Some(child.id());
            } else {
                // 子进程已退出：走统一清理（释放 managed PID、join stderr、重置 health）
                inner_clear(inner);
            }
        }

        let message = if !running {
            inner
                .last_startup_error
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| supervisor_status_message(running, inner.health_ok))
        } else {
            supervisor_status_message(running, inner.health_ok)
        };

        GatewaySupervisorStatus {
            supervised: running,
            pid,
            running,
            health_ok: running && inner.health_ok,
            message,
        }
    }

    /// 停止外部 daemon，确保仅本监管器可控制网关生命周期。
    pub fn reclaim_exclusive(&self) -> Result<(), String> {
        stop_all_gateways();
        let mut g = lock_supervisor(&self.inner);
        if let Some(mut child) = g.child.take() {
            let _ = child.kill();
            wait_child_timeout(&mut child, Duration::from_secs(3));
        }
        inner_clear(&mut g);
        Ok(())
    }

    pub fn status(&self) -> Result<GatewaySupervisorStatus, String> {
        let running_unhealthy = {
            let mut g = lock_supervisor(&self.inner);
            g.child.as_mut().map(child_running).unwrap_or(false) && !g.health_ok
        };
        if running_unhealthy && crate::openclaw::gateway_port_reachable() {
            let mut g = lock_supervisor(&self.inner);
            if g.child.as_mut().map(child_running).unwrap_or(false) {
                g.health_ok = true;
            }
            return Ok(Self::status_locked(&mut g));
        }
        let mut g = lock_supervisor(&self.inner);
        Ok(Self::status_locked(&mut g))
    }

    /// 轻量判断：监管子进程存活且 TCP 18789 可达（无 PowerShell / HTTP 探针）。
    pub fn is_operational_fast(&self) -> bool {
        let running = {
            let mut g = lock_supervisor(&self.inner);
            g.child.as_mut().map(child_running).unwrap_or(false)
        };
        running && crate::openclaw::gateway_port_reachable()
    }

    /// 桌面 IPC 专用：能快则快；否则后台 ensure 并**立即**返回当前 status，避免堵死 WebView 主线程。
    pub fn ensure_running_nonblocking(
        &self,
        app: &AppHandle,
        state: &State<'_, DbState>,
    ) -> Result<GatewaySupervisorStatus, String> {
        let need_heavy = !self.is_operational_fast()
            || crate::openclaw_control::peek_gateway_config_stale();

        if !need_heavy {
            if let Some(Ok(st)) = self.try_ensure_running(state) {
                return Ok(st);
            }
            return self.status();
        }

        if ENSURE_BG_IN_FLIGHT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return self.status();
        }

        let app = app.clone();
        if let Ok(handle) = std::thread::Builder::new()
            .name("yuntuai-ensure-bg".into())
            .spawn(move || {
                let _guard = EnsureBgGuard;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if let (Some(sup), Some(db)) = (
                        app.try_state::<GatewaySupervisor>(),
                        app.try_state::<DbState>(),
                    ) {
                        match sup.ensure_running(&db) {
                            Ok(_) => clear_ensure_backoff(),
                            Err(_) => bump_ensure_backoff(),
                        }
                        emit_exclusive_report(&app, &sup);
                    }
                }));
                if let Err(panic) = result {
                    eprintln!("[YunTuAI] background ensure panic: {panic:?}");
                }
            })
        {
            register_daemon_handle(handle);
        }
        self.status()
    }

    pub fn stop(&self, state: &State<'_, DbState>) -> Result<GatewaySupervisorStatus, String> {
        let _ = run_openclaw_timed(&["gateway", "stop"], Duration::from_secs(8));
        {
            let mut g = lock_supervisor(&self.inner);
            if let Some(mut child) = g.child.take() {
                let _ = child.kill();
                wait_child_timeout(&mut child, Duration::from_secs(3));
            }
            inner_clear(&mut g);
        }
        let conn = lock_conn(&state.conn);
        let _ = audit_insert_on_conn(&conn, "gateway", "supervisor_stop", "by=yuntuai");
        self.status()
    }

    pub fn ensure_running(&self, state: &State<'_, DbState>) -> Result<GatewaySupervisorStatus, String> {
        let _flight = ENSURE_SINGLE_FLIGHT
            .lock()
            .map_err(|e| format!("网关监管锁异常: {e}"))?;
        self.ensure_running_locked(state)
    }

    /// 后台自愈专用：若已有线程在 ensure 则跳过，避免 report-emitter 与 auto-ensure 叠加重型清理。
    pub fn try_ensure_running(&self, state: &State<'_, DbState>) -> Option<Result<GatewaySupervisorStatus, String>> {
        let _flight = ENSURE_SINGLE_FLIGHT.try_lock().ok()?;
        Some(self.ensure_running_locked(state))
    }

    /// `ensure_running` 主体；调用方必须已持有 `ENSURE_SINGLE_FLIGHT`。
    fn ensure_running_locked(&self, state: &State<'_, DbState>) -> Result<GatewaySupervisorStatus, String> {
        // 中转站：快速路径前对齐内嵌 Key。否则子进程仍用旧密钥启动时的环境，发消息即 403。
        if crate::distribution_policy::api_key_locked() {
            let _ = crate::openclaw_env::ensure_embedded_relay_api_key_on_disk();
        }

        // ── 快速路径：监管子进程存活 + 端口可达 + 无配置过期 → 跳过重型 suppress/CIM/reconcile。
        // 每次 ensure 都跑 PowerShell 扫全机 node 会占满 Tauri IPC 线程池，导致桌面整窗卡死。
        if !crate::openclaw_control::peek_gateway_config_stale() {
            let mut g = lock_supervisor(&self.inner);
            if g.child.as_mut().map(child_running).unwrap_or(false)
                && crate::openclaw::gateway_port_reachable()
            {
                g.health_ok = health_ok_once();
                return Ok(Self::status_locked(&mut g));
            }
        }

        let protect_pid = {
            let g = lock_supervisor(&self.inner);
            g.child.as_ref().map(|c| c.id())
        };
        crate::openclaw_exec::suppress_external_openclaw(protect_pid);

        let config_repaired = crate::openclaw_env::prepare_gateway_runtime_env().unwrap_or(false);
        let mut config_stale =
            config_repaired || crate::openclaw_control::take_gateway_config_stale();

        {
            let mut g = lock_supervisor(&self.inner);
            if reconcile_gateway_port(&mut g) {
                config_stale = true;
            }
        }

        // Machine 级 Token 与 .env 不一致：监管子进程已注入 .env，但端口上可能仍是 global 孤儿。
        if crate::openclaw_env::machine_env_conflicts_with_dotenv() {
            let mut g = lock_supervisor(&self.inner);
            if reconcile_gateway_port(&mut g) {
                config_stale = true;
            }
        }

        let supervised_alive = {
            let mut g = lock_supervisor(&self.inner);
            g.child
                .as_mut()
                .map(child_running)
                .unwrap_or(false)
        };
        // 端口可达但非 YunTuAI 监管：常见于升级后旧 openclaw 仍占用，会沿用无 allowedOrigins 的配置。
        // 先调用 force_kill_port_owner 立即释放端口（防止前次崩溃留下孤儿进程 / TCP TIME_WAIT 阻塞新连接），
        // 再走优雅 reclaim_exclusive 做 openclaw gateway stop + 清理子进程记录。
        if !supervised_alive && crate::openclaw::gateway_port_reachable() {
            let port = crate::openclaw::read_gateway_listen_endpoint()
                .map(|(_, p)| p)
                .unwrap_or(18789);
            force_kill_port_owner(port);
            let _ = self.reclaim_exclusive();
            config_stale = true;
        }

        let mut cleared_supervised_child = false;
        {
            let mut g = lock_supervisor(&self.inner);
            if let Some(ref mut child) = g.child {
                if child_running(child) {
                    drop(g);
                    let health_now = health_ok_once();
                    // 重新获取锁并验证子进程仍存活（health_ok_once 可能耗时 3s）
                    {
                        let mut g = lock_supervisor(&self.inner);
                        let still_alive = g.child.as_mut().map(child_running).unwrap_or(false);
                        if !still_alive {
                            inner_clear(&mut g);
                            cleared_supervised_child = true;
                            // 子进程在 health 探测期间已退出，跳过后面的跳过逻辑
                        } else if health_now {
                            // HTTP 健康已通过 → 网关可用。Windows 上监听 PID 常为子 node.exe，
                            // 而 child.id() 是启动器 PID，不能仅凭 PID 不等就 restart（会死锁）。
                            if config_stale {
                                drop(g);
                                return self.restart_locked(state);
                            }
                            g.health_ok = true;
                            return Ok(Self::status_locked(&mut g));
                        }
                    }
                    if !cleared_supervised_child {
                        // HTTP 健康检查失败时，检查 TCP 端口是否仍可达。
                        // 如果 TCP 端口可达，说明网关进程仍在运行，只是负载高峰期 HTTP 短暂无响应。
                        // 此时不 kill 子进程，避免推理任务被粗暴打断。
                        if crate::openclaw::gateway_port_reachable() {
                            // TCP 可达 → 网关在运行但繁忙，不 kill，保留当前状态
                            let mut g = lock_supervisor(&self.inner);
                            let still_alive = g.child.as_mut().map(child_running).unwrap_or(false);
                            if still_alive {
                                g.health_ok = false;
                                return Ok(Self::status_locked(&mut g));
                            }
                            // 子进程在 TCP 探测期间已退出
                            inner_clear(&mut g);
                            cleared_supervised_child = true;
                        } else {
                            // TCP 也失败 → 网关进程已死或端口被占，需要清理重启
                            let mut g = lock_supervisor(&self.inner);
                            if let Some(mut child) = g.child.take() {
                                let stderr_tail = read_stderr_tail(&g);
                                let _ = child.kill();
                                wait_child_timeout(&mut child, Duration::from_secs(3));
                                if !stderr_tail.is_empty() {
                                    eprintln!("[YunTuAI] gateway stderr (crash): {stderr_tail}");
                                }
                            }
                            inner_clear(&mut g);
                            cleared_supervised_child = true;
                        }
                    }
                    // 如果 cleared_supervised_child 为 true，循环结束，走下面的 spawn 逻辑
                } else {
                    inner_clear(&mut g);
                    cleared_supervised_child = true;
                }
            }
        }

        // 仅在没有刚清理过的受监管子进程时，才尝试停止外部 daemon。
        // 先快速探测端口是否已被占用——若端口空闲则跳过 `gateway stop`（该命令需启动 Node.js 子进程，
        // 已在 ensure_running 前方增加端口空闲快速路径，此 stop 仅当端口确实可达时执行；缩短超时至 5s）。
        if !cleared_supervised_child && crate::openclaw::gateway_port_reachable() {
            let _ = run_openclaw_timed(&["gateway", "stop"], Duration::from_secs(5));
        }

        // 强制释放端口 + 全面清理孤儿 OpenClaw 进程。
        // kill_orphan_openclaw_processes 用 wmic 搜索所有命令行含 "openclaw" 的 node.exe，
        // 前次崩溃/强杀后这些进程会变成孤儿持续占用 CPU/内存。
        // 传入 None 表示不跳过任何 PID——此时受监管子进程已被清理，不存在误杀风险。
        //
        // 先行 TCP 探针：若端口空闲则跳过昂贵的 wmic/netstat/taskkill，
        // 大幅缩短冷启动延迟（wmic 查询约 1-3s）。
        let port = crate::openclaw::read_gateway_listen_endpoint()
            .map(|(_, p)| p)
            .unwrap_or(18789);
        if crate::openclaw::gateway_port_reachable() {
            kill_orphan_openclaw_processes(crate::openclaw_exec::managed_gateway_pid());
            force_kill_port_owner(port);
        }

        let stderr_buf = {
            let g = lock_supervisor(&self.inner);
            Arc::clone(&g.stderr_buf)
        };
        let mut spawned = match spawn_and_await_healthy(&stderr_buf) {
            Ok(spawned) => {
                let mut g = lock_supervisor(&self.inner);
                g.last_startup_error = None;
                drop(g);
                spawned
            }
            Err(e) => {
                let mut g = lock_supervisor(&self.inner);
                g.last_startup_error = Some(e.clone());
                g.health_ok = false;
                return Err(e);
            }
        };

        {
            let mut g = lock_supervisor(&self.inner);
            // drainer 已在健康检查前启动；这里只接手句柄，避免管道无人读取。
            g.stderr_drainer = spawned.stderr_drainer.take();
            // Register the managed PID so no racing killer path tears down this fresh child.
            crate::openclaw_exec::set_managed_gateway_pid(Some(spawned.child.id()));
            g.child = Some(spawned.child);
            g.started_at = Some(Instant::now());
            g.health_ok = true;
        }

        let conn = lock_conn(&state.conn);
        let _ = audit_insert_on_conn(&conn, "gateway", "supervisor_start", "ensure_running ok health=ok");

        clear_ensure_backoff();
        self.status()
    }

    /// 桌面 IPC 专用：后台 stop + ensure，立即返回当前 status，避免堵死 WebView 主线程。
    pub fn restart_nonblocking(
        &self,
        app: &AppHandle,
        _state: &State<'_, DbState>,
    ) -> Result<GatewaySupervisorStatus, String> {
        if ENSURE_BG_IN_FLIGHT
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return self.status();
        }

        let app = app.clone();
        if let Ok(handle) = std::thread::Builder::new()
            .name("yuntuai-restart-bg".into())
            .spawn(move || {
                let _guard = EnsureBgGuard;
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if let (Some(sup), Some(db)) = (
                        app.try_state::<GatewaySupervisor>(),
                        app.try_state::<DbState>(),
                    ) {
                        match sup.restart(&db) {
                            Ok(_) => clear_ensure_backoff(),
                            Err(_) => bump_ensure_backoff(),
                        }
                        emit_exclusive_report(&app, &sup);
                    }
                }));
                if let Err(panic) = result {
                    eprintln!("[YunTuAI] background restart panic: {panic:?}");
                }
            })
        {
            register_daemon_handle(handle);
        }
        self.status()
    }

    pub fn restart(&self, state: &State<'_, DbState>) -> Result<GatewaySupervisorStatus, String> {
        let _flight = ENSURE_SINGLE_FLIGHT
            .lock()
            .map_err(|e| format!("网关监管锁异常: {e}"))?;
        self.restart_locked(state)
    }

    /// stop + ensure；调用方必须已持有 `ENSURE_SINGLE_FLIGHT`（避免同线程二次 lock 死锁）。
    fn restart_locked(&self, state: &State<'_, DbState>) -> Result<GatewaySupervisorStatus, String> {
        let _ = self.stop(state)?;
        // 子进程已 kill + wait，端口释放极快；缩短等待以减少前端连接等待时间。
        std::thread::sleep(Duration::from_millis(150));
        self.ensure_running_locked(state)
    }

    /// 托盘退出专用：同步短杀监管子进程 + 端口/孤儿清理，再后台做 CLI stop 与 daemon join。
    pub fn shutdown_on_app_exit(&self) {
        signal_app_shutdown();
        join_establish_work_timeout(Duration::from_secs(2));
        let port = crate::openclaw::read_gateway_listen_endpoint()
            .map(|(_, p)| p)
            .unwrap_or(18789);
        {
            let mut g = lock_supervisor(&self.inner);
            if let Some(mut child) = g.child.take() {
                let pid = child.id();
                let _ = child.kill();
                wait_child_timeout(&mut child, Duration::from_millis(400));
                // 进程树兜底：Windows 上 child.kill 可能只杀 launcher
                crate::openclaw_exec::kill_orphan_openclaw_processes(None);
                let _ = pid;
            }
            // 与 inner_clear 一致：绝不在退出路径上无限 join stderr drainer
            if let Some(handle) = g.stderr_drainer.take() {
                std::thread::Builder::new()
                    .name("yuntuai-stderr-join-exit".into())
                    .spawn(move || {
                        let _ = handle.join();
                    })
                    .ok();
            }
            crate::openclaw_exec::set_managed_gateway_pid(None);
            g.started_at = None;
            g.health_ok = false;
        }
        // 同步回收端口，降低下次启动「端口仍被占用」概率
        crate::openclaw_exec::force_kill_port_owner(port);
        crate::openclaw_exec::kill_orphan_openclaw_processes(None);

        std::thread::Builder::new()
            .name("yuntuai-exit-cleanup".into())
            .spawn(move || {
                let _ = run_openclaw_timed(&["gateway", "stop"], Duration::from_secs(3));
                crate::openclaw_exec::force_kill_port_owner(port);
                crate::openclaw_exec::kill_orphan_openclaw_processes(None);
                if let Ok(mut guards) = DAEMON_HANDLES.lock() {
                    for handle in guards.drain(..) {
                        std::thread::Builder::new()
                            .name("yuntuai-daemon-join".into())
                            .spawn(move || {
                                let _ = handle.join();
                            })
                            .ok();
                    }
                }
            })
            .ok();
    }

    /// TCP 探针巡检；返回 Ok(true) 健康，Ok(false) 不健康且已清理子进程。
    pub fn tick_health_watch(&self) -> Result<bool, String> {
        let child_state = {
            let mut g = lock_supervisor(&self.inner);
            if let Some(ref mut child) = g.child {
                if child_running(child) {
                    Some(true)
                } else {
                    inner_clear(&mut g);
                    None
                }
            } else {
                Some(false)
            }
        };
        match child_state {
            // 刚发现子进程已死并完成 inner_clear → 不健康，累加 fail_streak
            None => return Ok(false),
            // 当前无监管子进程（未启动 / 已主动停止）：不视为异常，避免空闲时误报 unhealthy 风暴
            Some(false) => return Ok(true),
            Some(true) => {}
        }
        if crate::openclaw::gateway_health_ok() {
            let mut g = lock_supervisor(&self.inner);
            g.health_ok = true;
            return Ok(true);
        }
        // 端口不可达但进程仍在 → 仅标记，不立即 kill
        // 交给 fail_streak 累积后由上层决策
        let mut g = lock_supervisor(&self.inner);
        g.health_ok = false;
        Ok(false)
    }
}

fn inner_clear(g: &mut SupervisorInner) {
    // join stderr drainer 线程（已在 read loop 中因 pipe EOF 自然退出）
    // 绝不在持有 supervisor 锁时无限 join：子进程仍存活时 drainer 会一直读 pipe，
    // 会把 status()/ensure 等所有桌面 IPC 卡死，表现为整窗无响应。
    if let Some(handle) = g.stderr_drainer.take() {
        std::thread::Builder::new()
            .name("yuntuai-stderr-join".into())
            .spawn(move || {
                let _ = handle.join();
            })
            .ok();
    }
    // Managed child gone → drop kill-protection so future orphan cleanup can reclaim its PID.
    crate::openclaw_exec::set_managed_gateway_pid(None);
    if let Ok(mut buf) = g.stderr_buf.lock() {
        buf.clear();
    }
    g.child = None;
    g.started_at = None;
    g.health_ok = false;
}

/// 启动后台线程持续读取子进程 stderr，仅保留尾部 STDERR_RING_SIZE 字节。
/// 防止无人读取时 pipe buffer 写满导致子进程 write 阻塞挂死。
fn spawn_stderr_drainer(stderr: ChildStderr, buf: Arc<Mutex<Vec<u8>>>) -> Option<std::thread::JoinHandle<()>> {
    std::thread::Builder::new()
        .name("yuntuai-stderr-drain".into())
        .spawn(move || {
            let mut reader = stderr;
            let mut chunk = [0u8; 1024];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break, // EOF: 子进程已退出
                    Ok(n) => {
                        if let Ok(mut guard) = buf.lock() {
                            guard.extend_from_slice(&chunk[..n]);
                            trim_stderr_ring_buf(&mut guard, STDERR_RING_SIZE);
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .ok()
}

fn stderr_tail_from_buf(buf: &Arc<Mutex<Vec<u8>>>) -> String {
    let guard = buf.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_empty() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&guard).trim().to_string();
    if text.len() > 512 {
        format!("…{}", &text[text.len().saturating_sub(512)..])
    } else {
        text
    }
}

/// 读取 stderr 环形缓冲区尾部内容，用于崩溃诊断。
fn read_stderr_tail(g: &SupervisorInner) -> String {
    stderr_tail_from_buf(&g.stderr_buf)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawExclusiveReport {
    pub supervisor: GatewaySupervisorStatus,
    pub bundled_ready: bool,
    pub global_openclaw_in_path: bool,
    pub global_openclaw_version: Option<String>,
    pub legacy_home_openclaw_exists: bool,
    pub legacy_home_openclaw_dir: Option<String>,
    pub data_dir: Option<String>,
    pub gateway_probe_running: Option<bool>,
    pub external_gateway_conflict: bool,
    #[serde(default)]
    pub port_reachable: bool,
    pub warnings: Vec<String>,
}

impl GatewaySupervisor {
    /// `full=true`：用户主动刷新 / RPC；`false`：后台 emitter，跳过重型 gateway status 探测。
    pub fn exclusive_report(&self, full: bool) -> Result<OpenClawExclusiveReport, String> {
        let supervisor = self.status()?;
        let bundled = crate::openclaw::bundled_openclaw_ready();
        let (global_in_path, global_version, legacy_exists, legacy_dir) = heavy_probes(full);
        let data_dir = crate::openclaw_control::managed_openclaw_data_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        let gateway_probe = if supervisor.running && supervisor.health_ok {
            None
        } else if full && bundled {
            crate::openclaw::gateway_status_probe()
        } else {
            None
        };
        let port = crate::openclaw::read_gateway_listen_endpoint()
            .map(|(_, p)| p)
            .unwrap_or(18789);
        let port_reachable = crate::openclaw::gateway_port_reachable();
        // 轻量报告不要 netstat（最多 5s）；仅用户主动 full 刷新才核对监听 PID。
        let port_owner = if full && port_reachable {
            port_listening_pid(port)
        } else {
            None
        };
        let supervised_pid = supervisor.pid;
        let pid_mismatch = match (port_owner, supervised_pid) {
            (Some(o), Some(c)) => o != c,
            (Some(_), None) => true,
            _ => false,
        };
        // Windows 上监听 PID 常为 node 子进程，与监管启动器 PID 不同；健康时勿误报冲突。
        let supervised_looks_ok = supervisor.running && (supervisor.health_ok || port_reachable);
        let port_busy_unsupervised = port_reachable
            && !supervised_looks_ok
            && (!supervisor.running || pid_mismatch);
        let external_gateway_conflict = if supervised_looks_ok {
            false
        } else {
            port_busy_unsupervised || (!supervisor.running && gateway_probe == Some(true))
        };

        let mut warnings = Vec::new();
        if global_in_path {
            let ver = global_version
                .as_ref()
                .map(|v| format!(" ({v})"))
                .unwrap_or_default();
            warnings.push(format!(
                "检测到系统 PATH 中存在独立本机版运行时{ver}，可能与 YunTuAI 内置版本冲突。建议卸载全局安装或将其移出 PATH。"
            ));
        }
        if legacy_exists {
            let dir = legacy_dir.as_deref().unwrap_or("旧版用户目录");
            warnings.push(format!(
                "检测到旧版用户目录 {dir}。YunTuAI 使用安装目录下的服务数据目录，请勿混用两处配置。"
            ));
        }
        if external_gateway_conflict {
            warnings.push(
                "18789 端口有网关进程，但不由 YunTuAI 监管（常见于调试残留或外部运行时）。请点击「回收控制权」或「手动重连」。"
                    .into(),
            );
        }
        if !bundled && crate::openclaw_runtime::prefers_bundled_runtime() && !cfg!(debug_assertions) {
            warnings.push(
                "内置版运行时未就绪。请重新安装 YunTu Control，或等待首次启动自动解压完成。".into(),
            );
        }
        if supervisor.running {
            warnings.insert(
                0,
                format!(
                    "本机服务由 YunTu Control 独占监管（PID {}）。",
                    supervisor.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into())
                ),
            );
        }

        Ok(OpenClawExclusiveReport {
            supervisor,
            bundled_ready: bundled,
            global_openclaw_in_path: global_in_path,
            global_openclaw_version: global_version,
            legacy_home_openclaw_exists: legacy_exists,
            legacy_home_openclaw_dir: legacy_dir,
            data_dir,
            gateway_probe_running: gateway_probe,
            external_gateway_conflict,
            port_reachable,
            warnings,
        })
    }
}

#[tauri::command]
pub async fn openclaw_exclusive_report(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
    full: Option<bool>,
) -> Result<OpenClawExclusiveReport, String> {
    let conn = state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let sup = app.state::<GatewaySupervisor>();
        sup.exclusive_report(full.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gateway_supervisor_reclaim(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawExclusiveReport, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();
        sup.reclaim_exclusive()?;
        {
            let c = lock_conn(&conn);
            let _ = audit_insert_on_conn(&c, "gateway", "supervisor_reclaim", "by=user");
        }
        let _ = sup.ensure_running_nonblocking(&app, &db);
        let report = sup.exclusive_report(true)?;
        emit_exclusive_report(&app, &sup);
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn gateway_supervisor_status(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewaySupervisorStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        app.state::<GatewaySupervisor>().status()
    })
    .await
}

#[tauri::command]
pub async fn gateway_supervisor_ensure(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewaySupervisorStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();
        let status = sup.ensure_running_nonblocking(&app, &db)?;
        emit_exclusive_report(&app, &sup);
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn gateway_supervisor_stop(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewaySupervisorStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let db = app.state::<DbState>();
        app.state::<GatewaySupervisor>().stop(&db)
    })
    .await
}

#[tauri::command]
pub async fn gateway_supervisor_restart(
    app: AppHandle,
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewaySupervisorStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let sup = app.state::<GatewaySupervisor>();
        let db = app.state::<DbState>();
        let status = sup.restart_nonblocking(&app, &db)?;
        emit_exclusive_report(&app, &sup);
        Ok(status)
    })
    .await
}

/// 监管状态文案（纯函数，供测试与 `status_locked` 共用）。
pub(crate) fn supervisor_status_message(running: bool, health_ok: bool) -> String {
    if running {
        if health_ok {
            "本机服务由 YunTu Control 监管运行中".to_string()
        } else {
            "本机服务进程已启动，健康检查尚未通过".to_string()
        }
    } else {
        "本机服务未在 YunTu Control 监管下运行".to_string()
    }
}

/// 端口监听 PID 与受管子进程不一致时需回收（纯函数）。
pub(crate) fn port_owner_needs_reconcile(child_pid: Option<u32>, owner_pid: u32) -> bool {
    child_pid != Some(owner_pid)
}

/// 健康看门狗连续失败次数达到阈值时应通知前端。
pub(crate) fn health_watch_should_emit_unhealthy(fail_streak: u32) -> bool {
    fail_streak >= HEALTH_WATCH_FAILS_BEFORE_KILL
}

/// stderr 环形缓冲区裁剪（纯函数）。
pub(crate) fn trim_stderr_ring_buf(buf: &mut Vec<u8>, max_bytes: usize) {
    if buf.len() > max_bytes {
        let excess = buf.len() - max_bytes;
        buf.drain(..excess);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_status_message_running_healthy() {
        assert_eq!(
            supervisor_status_message(true, true),
            "本机服务由 YunTu Control 监管运行中"
        );
    }

    #[test]
    fn supervisor_status_message_running_not_healthy() {
        assert_eq!(
            supervisor_status_message(true, false),
            "本机服务进程已启动，健康检查尚未通过"
        );
    }

    #[test]
    fn supervisor_status_message_stopped() {
        assert_eq!(
            supervisor_status_message(false, false),
            "本机服务未在 YunTu Control 监管下运行"
        );
    }

    #[test]
    fn port_owner_needs_reconcile_when_pids_differ() {
        assert!(port_owner_needs_reconcile(Some(100), 200));
        assert!(port_owner_needs_reconcile(None, 200));
        assert!(!port_owner_needs_reconcile(Some(200), 200));
    }

    #[test]
    fn health_watch_emits_after_three_fails() {
        assert!(!health_watch_should_emit_unhealthy(0));
        assert!(!health_watch_should_emit_unhealthy(2));
        assert!(health_watch_should_emit_unhealthy(3));
        assert!(health_watch_should_emit_unhealthy(4));
    }

    #[test]
    fn trim_stderr_ring_keeps_tail() {
        let mut buf: Vec<u8> = (0..20).collect();
        trim_stderr_ring_buf(&mut buf, 8);
        assert_eq!(buf.len(), 8);
        assert_eq!(buf, vec![12, 13, 14, 15, 16, 17, 18, 19]);
    }

    #[test]
    fn health_watch_interval_and_threshold_constants() {
        assert_eq!(HEALTH_WATCH_INTERVAL_SECS, 10);
        assert_eq!(HEALTH_WATCH_FAILS_BEFORE_KILL, 3);
        assert_eq!(HEALTH_POLL_ROUNDS, 225);
        assert_eq!(SPAWN_MAX_RETRIES, 3);
    }

    #[test]
    fn light_heavy_probes_return_immediately_without_cache_wait() {
        let t0 = Instant::now();
        let _ = heavy_probes(false);
        assert!(
            t0.elapsed() < Duration::from_millis(80),
            "light exclusive_report must not run where/openclaw --version"
        );
    }

    #[test]
    fn join_establish_work_timeout_empty_is_noop() {
        join_establish_work_timeout(Duration::from_millis(50));
    }

    #[test]
    fn register_and_join_finished_establish_work() {
        let handle = std::thread::spawn(|| {});
        register_establish_work_handle(handle);
        join_establish_work_timeout(Duration::from_secs(2));
    }
}