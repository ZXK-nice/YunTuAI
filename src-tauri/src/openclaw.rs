//! OpenClaw 路径与独占控制探测（不读取/合并配置文件内容）。

use crate::db::DbState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

fn read_dotenv_value(data_dir: &Path, key: &str) -> Option<String> {
    let raw = std::fs::read_to_string(data_dir.join(".env")).ok()?;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                let t = v.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
    }
    None
}

fn openclaw_dir() -> Result<PathBuf, String> {
    crate::openclaw_control::managed_openclaw_data_dir()
}

/// 读取网关监听地址（openclaw-data/.env）。
pub(crate) fn read_gateway_listen_endpoint() -> Option<(String, u16)> {
    let data_dir = openclaw_dir().ok()?;
    let port = read_dotenv_value(&data_dir, "OPENCLAW_GATEWAY_PORT")
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(18789);
    let host = read_dotenv_value(&data_dir, "OPENCLAW_GATEWAY_HOST")
        .unwrap_or_else(|| "127.0.0.1".to_string());
    Some((host, port))
}

/// 健康检查结果缓存，避免启动/看门狗中密集探测时反复等待 TCP 超时。
use std::sync::atomic::{AtomicU64, Ordering};

/// 最近一次健康检查结果（0=未检查过 / 上次失败，1=上次成功）。
static CACHED_HEALTH_OK: AtomicU64 = AtomicU64::new(0);
/// 最近一次健康检查的时刻（Instant 的单调时钟，通过 transmute 存 u64）。
static CACHED_HEALTH_AT: AtomicU64 = AtomicU64::new(0);
/// 只短暂记住失败，避免连打 HTTP。成功不缓存：端口刚起来或刚退出时，旧的「健康」会让界面误判。
const HEALTH_CACHE_TTL_MS: u64 = 800;

/// 读取缓存的健康检查结果。`force=true` 跳过缓存。
fn cached_health_ok(force: bool) -> Option<bool> {
    if force {
        return None;
    }
    let at = CACHED_HEALTH_AT.load(Ordering::Relaxed);
    if at == 0 {
        return None;
    }
    // at 存储的是 SystemTime 的 epoch millis
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if now.saturating_sub(at) >= HEALTH_CACHE_TTL_MS {
        return None;
    }
    let ok = CACHED_HEALTH_OK.load(Ordering::Relaxed);
    if ok == 0 {
        Some(false)
    } else {
        None
    }
}

fn set_cached_health(ok: bool) {
    CACHED_HEALTH_OK.store(if ok { 1 } else { 0 }, Ordering::Relaxed);
    CACHED_HEALTH_AT.store(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        Ordering::Relaxed,
    );
}

/// 轻量 TCP 探针：端口可连即视为网关进程已就绪（替代热路径 CLI health 子进程）。
pub(crate) fn gateway_port_reachable() -> bool {
    use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let Some((host, port)) = read_gateway_listen_endpoint() else {
        return false;
    };
    let host = if host == "0.0.0.0" || host == "::" {
        "127.0.0.1".to_string()
    } else {
        host
    };
    let addr = if let Ok(ip) = host.parse::<IpAddr>() {
        SocketAddr::new(ip, port)
    } else {
        let Ok(mut addrs) = format!("{host}:{port}").to_socket_addrs() else {
            return false;
        };
        let Some(addr) = addrs.next() else {
            return false;
        };
        addr
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

/// HTTP 探针：任意 HTTP 响应（含 404/426）均表示端口上有服务在监听。
/// 超时 3000ms（原 1200ms），模型推理高峰期网关 HTTP 线程可能短暂繁忙，更长的超时减少误判。
pub(crate) fn gateway_http_health_ok() -> bool {
    let Some((host, port)) = read_gateway_listen_endpoint() else {
        return false;
    };
    let url = format!("http://{host}:{port}/");
    match ureq::get(&url).timeout(std::time::Duration::from_millis(3000)).call() {
        Ok(_) => true,
        Err(ureq::Error::Status(_, _)) => true,
        Err(_) => false,
    }
}

/// 热路径健康检查：HTTP → TCP，不 spawn CLI 子进程。
/// 内置负面缓存：上次失败后 800ms 内直接返回 false，避免密集轮询中每轮等 TCP 超时。
pub(crate) fn gateway_health_ok() -> bool {
    if let Some(cached) = cached_health_ok(false) {
        return cached;
    }
    gateway_health_ok_uncached()
}

/// 强制探测并刷新缓存（spawn 等待循环、ensure 后验证必须使用，避免负面缓存误杀新进程）。
pub(crate) fn gateway_health_ok_uncached() -> bool {
    let ok = gateway_http_health_ok();
    set_cached_health(ok);
    ok
}

/// 清除健康缓存（新网关 spawn 前调用）。
pub(crate) fn clear_gateway_health_cache() {
    CACHED_HEALTH_AT.store(0, Ordering::Relaxed);
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawDirStatus {
    pub dir: String,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConnectCredentials {
    pub host: String,
    pub port: u16,
    pub token: Option<String>,
}

#[tauri::command]
pub async fn openclaw_dir_status(
    state: State<'_, DbState>,
    token: String,
) -> Result<OpenClawDirStatus, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let dir = openclaw_dir()?;
        let exists = dir.exists();
        Ok(OpenClawDirStatus {
            dir: dir.to_string_lossy().to_string(),
            exists,
        })
    })
    .await
}

/// 桌面端连接参数：Token 来自 openclaw-data/.env（由首次启动 bootstrap 写入）。
#[tauri::command]
pub async fn get_gateway_connect_credentials(
    state: State<'_, DbState>,
    token: String,
) -> Result<GatewayConnectCredentials, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        crate::license::assert_licensed()?;
        let data_dir = openclaw_dir()?;
        let port = read_dotenv_value(&data_dir, "OPENCLAW_GATEWAY_PORT")
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(18789);
        let host =
            read_dotenv_value(&data_dir, "OPENCLAW_GATEWAY_HOST").unwrap_or_else(|| "127.0.0.1".to_string());
        let gw_token = read_dotenv_value(&data_dir, "OPENCLAW_GATEWAY_TOKEN")
            .or_else(crate::openclaw_control::read_sealed_gateway_token);
        Ok(GatewayConnectCredentials {
            host,
            port,
            token: gw_token,
        })
    })
    .await
}

fn where_openclaw_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "windows") {
        let mut cmd = std::process::Command::new("where");
        cmd.arg("openclaw")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        crate::openclaw_exec::hide_console(&mut cmd);
        let Ok(mut child) = cmd.spawn() else { return vec![] };
        let start = std::time::Instant::now();
        let mut out = Vec::new();
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => {
                    if let Some(mut stdout) = child.stdout.take() {
                        let _ = std::io::Read::read_to_end(&mut stdout, &mut out);
                    }
                    let text = String::from_utf8_lossy(&out);
                    return text
                        .lines()
                        .map(|l| PathBuf::from(l.trim()))
                        .filter(|p| p.is_file())
                        .collect();
                }
                Ok(Some(_)) => return vec![],
                Ok(None) => {
                    if start.elapsed() > std::time::Duration::from_secs(8) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return vec![];
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => {
                    let _ = child.kill();
                    return vec![];
                }
            }
        }
    } else {
        let mut cmd = std::process::Command::new("which");
        cmd.arg("openclaw")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let Ok(mut child) = cmd.spawn() else { return vec![] };
        let start = std::time::Instant::now();
        let mut out = Vec::new();
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => {
                    if let Some(mut stdout) = child.stdout.take() {
                        let _ = std::io::Read::read_to_end(&mut stdout, &mut out);
                    }
                    let p = String::from_utf8_lossy(&out).trim().to_string();
                    return if p.is_empty() {
                        vec![]
                    } else {
                        vec![PathBuf::from(p)]
                    };
                }
                Ok(Some(_)) => return vec![],
                Ok(None) => {
                    if start.elapsed() > std::time::Duration::from_secs(8) {
                        let _ = child.kill();
                        let _ = child.wait();
                        return vec![];
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                Err(_) => {
                    let _ = child.kill();
                    return vec![];
                }
            }
        }
    }
}

fn path_under_dir(path: &Path, dir: &Path) -> bool {
    path.canonicalize()
        .ok()
        .and_then(|p| dir.canonicalize().ok().map(|d| p.starts_with(d)))
        .unwrap_or_else(|| path.starts_with(dir))
}

#[cfg(target_os = "windows")]
fn global_openclaw_launch_priority(path: &Path) -> u8 {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("cmd") => 0,
        Some(ext) if ext.eq_ignore_ascii_case("exe") => 1,
        Some(ext) if ext.eq_ignore_ascii_case("bat") => 2,
        Some(ext) if ext.eq_ignore_ascii_case("com") => 3,
        Some(ext) if ext.eq_ignore_ascii_case("ps1") => 4,
        _ => 9,
    }
}

#[cfg(target_os = "windows")]
fn normalize_global_openclaw_launcher(path: &Path) -> PathBuf {
    if path.extension().is_none() {
        if let Some(dir) = path.parent() {
            let cmd = dir.join("openclaw.cmd");
            if cmd.is_file() {
                return cmd;
            }
        }
    }
    path.to_path_buf()
}

fn pick_global_openclaw_exe(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    if candidates.is_empty() {
        return None;
    }
    #[cfg(target_os = "windows")]
    {
        let mut sorted = candidates;
        sorted.sort_by_key(|p| global_openclaw_launch_priority(p));
        let best = sorted.first()?;
        Some(normalize_global_openclaw_launcher(best))
    }
    #[cfg(not(target_os = "windows"))]
    {
        candidates.into_iter().next()
    }
}

fn command_for_executable(exe: &Path, args: &[&str]) -> std::process::Command {
    if cfg!(target_os = "windows") {
        if let Some(ext) = exe.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat") {
                let mut cmd = std::process::Command::new("cmd");
                cmd.arg("/c").arg(exe).args(args);
                crate::openclaw_exec::hide_console(&mut cmd);
                return cmd;
            }
            if ext.eq_ignore_ascii_case("ps1") {
                let mut cmd = std::process::Command::new("powershell");
                cmd.arg("-NoProfile")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-WindowStyle")
                    .arg("Hidden")
                    .arg("-File")
                    .arg(exe)
                    .args(args);
                crate::openclaw_exec::hide_console(&mut cmd);
                return cmd;
            }
        }
    }
    let mut cmd = std::process::Command::new(exe);
    cmd.args(args);
    cmd
}

pub(crate) fn resolve_global_openclaw_exe() -> Option<PathBuf> {
    let portable = crate::paths::openclaw_exe_path()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let candidates: Vec<PathBuf> = where_openclaw_paths()
        .into_iter()
        .filter(|p| {
            portable
                .as_ref()
                .map(|port| !path_under_dir(p, port))
                .unwrap_or(true)
        })
        .collect();

    pick_global_openclaw_exe(candidates)
}

pub(crate) fn probe_global_openclaw() -> (bool, Option<String>) {
    let Some(p) = resolve_global_openclaw_exe() else {
        return (false, None);
    };
    // 用 spawn + try_wait 带超时避免 `--version` 阻塞.
    let mut version_cmd = command_for_executable(&p, &["--version"]);
    version_cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    crate::openclaw_exec::hide_console(&mut version_cmd);
    let Ok(mut child) = version_cmd.spawn() else {
        return (false, None);
    };
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    let mut out = String::new();
                    let _ = child.stdout.as_mut().and_then(|s| {
                        std::io::Read::read_to_string(s, &mut out).ok()
                    });
                    let text = out.trim().to_string();
                    return if text.is_empty() {
                        (true, None)
                    } else {
                        (true, Some(text))
                    };
                }
                return (false, None);
            }
            Ok(None) => {
                if start.elapsed() > std::time::Duration::from_secs(8) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (false, None);
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(_) => {
                let _ = child.kill();
                return (false, None);
            }
        }
    }
}

pub(crate) fn probe_legacy_home_openclaw() -> (bool, Option<String>) {
    let dir = dirs::home_dir().map(|h| h.join(".openclaw"));
    match dir {
        Some(d) => (d.exists(), Some(d.to_string_lossy().to_string())),
        None => (false, None),
    }
}

pub(crate) fn bundled_openclaw_ready() -> bool {
    crate::paths::openclaw_exe_path()
        .ok()
        .and_then(|cmd| cmd.parent().map(|p| p.to_path_buf()))
        .map(|dir| crate::openclaw_platform::portable_runtime_ready(&dir))
        .unwrap_or(false)
}

pub(crate) fn gateway_status_probe() -> Option<bool> {
    let result = crate::openclaw_exec::run_openclaw_timed(
        &["gateway", "status", "--json"],
        std::time::Duration::from_secs(10),
    )
    .ok()?;
    if !result.ok {
        return None;
    }
    let text = result.stdout;
    Some(
        text.contains("\"ok\":true")
            || text.contains("\"status\":\"running\"")
            || text.contains("\"running\""),
    )
}

/// 终止所有非 YunTuAI 监管的 OpenClaw 网关（内置 + 全局 PATH）。
pub(crate) fn stop_all_external_gateways() {
    if crate::openclaw_control::should_defer_heavy_gateway_ipc() {
        eprintln!("[YunTuAI] defer stop_all: establish_absolute_control still running");
        return;
    }
    crate::openclaw_exec::stop_all_gateways();
    let portable = crate::paths::openclaw_exe_path()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    for p in where_openclaw_paths() {
        let is_bundled = portable
            .as_ref()
            .map(|port| path_under_dir(&p, port))
            .unwrap_or(false);
        if is_bundled {
            continue;
        }
        let mut stop_cmd = command_for_executable(&p, &["gateway", "stop"]);
        stop_cmd
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        crate::openclaw_exec::hide_console(&mut stop_cmd);
        let _ = stop_cmd.status();
    }
}

/* ── 直接读磁盘 openclaw.json 获取 MCP 服务器列表 ──────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerEntry {
    pub name: String,
    pub description: Option<String>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub enabled: bool,
    pub tool_count: u32,
}

/// 读取服务配置文件，提取 `tools.mcpServers` / `tools.servers` / `mcpServers` 字段。
/// 不要求 Owner 权限（普通已登录用户即可看到 MCP 列表）。
#[tauri::command]
pub(crate) async fn openclaw_read_mcp_servers(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
) -> Result<Vec<McpServerEntry>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        read_mcp_servers_inner()
    })
    .await
}

fn read_mcp_servers_inner() -> Result<Vec<McpServerEntry>, String> {
    let data_dir = crate::openclaw_control::managed_openclaw_data_dir()?;
    let cfg_path = data_dir.join("openclaw.json");
    if !cfg_path.is_file() {
        return Ok(vec![]);
    }

    let raw = std::fs::read_to_string(&cfg_path).map_err(|e| format!("读取服务配置文件: {e}"))?;
    let root: serde_json::Value =
        serde_json::from_str(crate::openclaw_runtime::strip_bom(&raw))
            .map_err(|e| format!("解析服务配置文件: {e}"))?;

    // 多层级查找 mcpServers
    let mcp_section = root
        .get("tools")
        .and_then(|t| t.get("mcpServers"))
        .or_else(|| root.get("tools").and_then(|t| t.get("servers")))
        .or_else(|| root.get("mcpServers"))
        .or_else(|| root.get("mcp").and_then(|m| m.get("servers")));

    let Some(section) = mcp_section else {
        return Ok(vec![]);
    };
    let Some(obj) = section.as_object() else {
        return Ok(vec![]);
    };

    let mut servers: Vec<McpServerEntry> = Vec::new();
    for (name, val) in obj {
        let Some(entry) = val.as_object() else {
            continue;
        };
        let command = entry.get("command").and_then(|v| v.as_str()).map(String::from);
        let args = entry
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect());
        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .map(String::from);
        let enabled = entry.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

        servers.push(McpServerEntry {
            name: name.clone(),
            description,
            command,
            args,
            enabled,
            tool_count: 0, // RPC 侧统计工具数后补充
        });
    }

    Ok(servers)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "windows")]
    fn pick_global_openclaw_prefers_cmd_over_extensionless() {
        let picked = pick_global_openclaw_exe(vec![
            PathBuf::from(r"C:\npm\openclaw"),
            PathBuf::from(r"C:\npm\openclaw.cmd"),
        ]);
        assert_eq!(
            picked.as_deref().map(|p| p.to_string_lossy().to_string()),
            Some(r"C:\npm\openclaw.cmd".to_string())
        );
    }
}
