//! OpenClaw subprocess execution (CLI + supervisor).

use crate::openclaw::{bundled_openclaw_ready, probe_global_openclaw};
use crate::openclaw_runtime::RuntimeSource;
use serde::Serialize;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// PID of the gateway child currently supervised by YunTuAI (0 = none).
///
/// Every "kill gateway / free port / kill orphan" path consults this so that no background
/// thread (auto-ensure, connect preflight suppression, reconcile, health watch, report emitter)
/// can accidentally kill the freshly-spawned managed gateway while another thread is racing.
/// That accidental self-kill is what produced the repeated kill→respawn churn and the transient
/// "gateway momentarily gone → frontend can't connect" windows. The managed child is always torn
/// down through its own `Child` handle (which is unaffected by this guard), never via the blunt
/// port/orphan killers.
static MANAGED_GATEWAY_PID: AtomicU32 = AtomicU32::new(0);

/// Record (or clear, with `None`) the PID of the currently supervised gateway child.
pub fn set_managed_gateway_pid(pid: Option<u32>) {
    MANAGED_GATEWAY_PID.store(pid.unwrap_or(0), Ordering::SeqCst);
}

/// The currently supervised gateway PID, if any.
pub fn managed_gateway_pid() -> Option<u32> {
    match MANAGED_GATEWAY_PID.load(Ordering::SeqCst) {
        0 => None,
        p => Some(p),
    }
}

/// True when `pid` must never be force-killed by the blunt port/orphan killers:
/// PID 0, our own process, an explicitly protected PID, or the supervised gateway child.
fn is_kill_protected(pid: u32, skip_pid: Option<u32>) -> bool {
    pid == 0
        || pid == std::process::id()
        || skip_pid == Some(pid)
        || managed_gateway_pid() == Some(pid)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawCliResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

const MAX_CLI_STREAM_BYTES: usize = 512 * 1024;

/// Hide console window for child processes on Windows.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…(truncated)", &s[..max])
    }
}

fn cap_stream(s: &str) -> String {
    truncate(s, MAX_CLI_STREAM_BYTES)
}

fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
    sink: Arc<Mutex<Vec<u8>>>,
) -> Option<thread::JoinHandle<()>> {
    pipe.map(|mut reader| {
        thread::spawn(move || {
            let mut buf = Vec::with_capacity(MAX_CLI_STREAM_BYTES.min(65536));
            let mut chunk = [0u8; 8192];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        if buf.len().saturating_add(n) > MAX_CLI_STREAM_BYTES {
                            let remain = MAX_CLI_STREAM_BYTES.saturating_sub(buf.len());
                            if remain > 0 {
                                buf.extend_from_slice(&chunk[..remain]);
                            }
                            break;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    Err(_) => break,
                }
            }
            if let Ok(mut g) = sink.lock() {
                *g = buf;
            }
        })
    })
}

#[cfg(test)]
fn should_apply_bundled_npm_env(_source: RuntimeSource) -> bool {
    true
}

fn path_segment_has_openclaw_launcher(segment: &str) -> bool {
    let p = Path::new(segment.trim());
    if p
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("openclaw") || n.starts_with("openclaw."))
        .unwrap_or(false)
    {
        return true;
    }
    p.join(crate::openclaw_platform::openclaw_launcher_name()).is_file()
        || p.join("openclaw.exe").is_file()
}

/// 子进程 PATH 剔除全局 openclaw，避免与内置运行时混用。
fn apply_bundled_path_isolation(cmd: &mut Command) {
    let Ok(cmd_path) = crate::paths::openclaw_exe_path() else {
        return;
    };
    let Some(portable_dir) = cmd_path.parent() else {
        return;
    };
    let node_runtime = portable_dir.join("node-runtime");
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut segments: Vec<String> = Vec::new();
    if node_runtime.is_dir() {
        segments.push(node_runtime.to_string_lossy().into_owned());
    }
    if let Ok(path_val) = std::env::var("PATH") {
        for part in path_val.split(sep) {
            let trimmed = part.trim();
            if trimmed.is_empty() || path_segment_has_openclaw_launcher(trimmed) {
                continue;
            }
            segments.push(trimmed.to_string());
        }
    }
    if !segments.is_empty() {
        cmd.env("PATH", segments.join(sep));
    }
}

/// Windows 可能继承 Machine 级环境变量；子进程写入 .env 前显式清除，确保管控目录优先。
const CHILD_ENV_OVERRIDE_KEYS: &[&str] = &[
    "DEEPSEEK_API_KEY",
    "DASHSCOPE_API_KEY",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_GATEWAY_PORT",
    "OPENCLAW_GATEWAY_HOST",
    "YUNTUAI_API_KEY",
    "AGNES_API_KEY",
    "RAGFLOW_API_KEY",
    "RAGFLOW_API_URL",
];

/// Apply OpenClaw state dir, `.env`, and bundled npm paths to child processes.
pub fn apply_openclaw_child_env(cmd: &mut Command, _source: RuntimeSource) {
    cmd.env("YUNTUAI_MANAGED_SUBPROCESS", "1");
    apply_bundled_path_isolation(cmd);
    if let Ok(cmd_path) = crate::paths::openclaw_exe_path() {
        if let Some(portable_dir) = cmd_path.parent() {
            let npm_prefix = portable_dir.join("npm-prefix");
            if npm_prefix.is_dir() {
                cmd.env("NPM_PREFIX", &npm_prefix);
                let node_modules = npm_prefix.join("node_modules");
                if node_modules.is_dir() {
                    cmd.env("NODE_PATH", &node_modules);
                }
            }
        }
    }
    // 限制内置 Node.js 的最大堆内存，降低低配机内存压力
    if let Ok(mb) = crate::openclaw_runtime::read_gateway_memory_limit_mb() {
        cmd.env("NODE_OPTIONS", format!("--max-old-space-size={mb}"));
    }
    if let Ok(data_dir) = crate::openclaw_control::managed_openclaw_data_dir() {
        // OPENCLAW_STATE_DIR → openclaw-data/openclaw.json（YunTuAI 管控的配置根）。
        // 若误设 OPENCLAW_HOME=openclaw-data，OpenClaw 会再套一层 .openclaw/，导致读错配置。
        cmd.env("OPENCLAW_STATE_DIR", &data_dir);
        cmd.env_remove("OPENCLAW_HOME");
        let env_file = data_dir.join(".env");
        for key in CHILD_ENV_OVERRIDE_KEYS {
            cmd.env_remove(key);
        }
        if let Ok(raw) = std::fs::read_to_string(&env_file) {
            for line in raw.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let key = k.trim();
                    let val = v.trim();
                    if !key.is_empty() {
                        // Windows 可能继承 Machine 级无效密钥；先移除再写入 .env，确保管控目录优先。
                        cmd.env_remove(key);
                        cmd.env(key, val);
                    }
                }
            }
        }
    }
}

#[allow(dead_code)]
fn is_windows_script(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false)
}

#[allow(dead_code)]
fn command_for_executable(exe: &Path, args: &[&str]) -> Command {
    if cfg!(target_os = "windows") && is_windows_script(exe) {
        let mut cmd = Command::new("cmd");
        cmd.arg("/c").arg(exe).args(args);
        cmd
    } else if exe.extension().and_then(|e| e.to_str()) == Some("sh") {
        let mut cmd = Command::new("/bin/bash");
        cmd.arg(exe).args(args);
        cmd
    } else {
        let mut cmd = Command::new(exe);
        cmd.args(args);
        cmd
    }
}

fn bundled_node_entry() -> Option<(PathBuf, PathBuf)> {
    let exe_path = crate::paths::openclaw_exe_path().ok()?;
    let portable_dir = exe_path.parent()?;
    let node = crate::openclaw_platform::node_runtime_executable(portable_dir);
    let entry = crate::openclaw_platform::openclaw_mjs_path(portable_dir);
    if node.is_file() && entry.is_file() {
        Some((node, entry))
    } else {
        None
    }
}

fn finalize_command(mut cmd: Command, source: RuntimeSource) -> Command {
    apply_openclaw_child_env(&mut cmd, source);
    hide_console(&mut cmd);
    cmd
}

pub fn build_openclaw_command_for_source(
    _source: RuntimeSource,
    args: &[&str],
) -> Result<Command, String> {
    if let Some((node, entry)) = bundled_node_entry() {
        let mut cmd = Command::new(node);
        cmd.arg(entry).args(args);
        return Ok(finalize_command(cmd, RuntimeSource::Bundled));
    }
    Err("内置本机服务运行时尚未就绪。请等待首次配置完成，或重新安装 YunTuAI。".into())
}

pub fn build_openclaw_command_with_args(args: &[&str]) -> Result<Command, String> {
    build_openclaw_command_for_source(RuntimeSource::Bundled, args)
}

pub fn build_openclaw_gateway_foreground_command() -> Result<Command, String> {
    // 必须使用 `gateway run`（不是 `gateway`），否则 OpenClaw 会显示帮助并退出。
    // stdout → null：长期运行的网关进程输出量不可预测，无人读取时 pipe buffer 写满会 block 子进程。
    // stderr → piped：由 gateway_supervisor 的后台 drainer 线程持续读取，仅保留尾部用于崩溃诊断。
    let mut cmd = build_openclaw_command_with_args(&["gateway", "run", "--force"])?;
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);
    Ok(cmd)
}

pub fn run_openclaw_for_source_timed(
    args: &[&str],
    source: RuntimeSource,
    timeout: Duration,
) -> Result<OpenClawCliResult, String> {
    crate::license::assert_licensed()?;
    let mut cmd = build_openclaw_command_for_source(source, args)?;
    run_command_timed(&mut cmd, timeout)
}

pub fn run_openclaw_timed(args: &[&str], timeout: Duration) -> Result<OpenClawCliResult, String> {
    let mut cmd = build_openclaw_command_with_args(args)?;
    run_command_timed(&mut cmd, timeout)
}

/// 带超时的子进程 output，保留 stdout/stderr（用于 npm install 等长任务）。
pub fn command_output_timed_full(mut cmd: Command, timeout: Duration) -> Option<std::process::Output> {
    hide_console(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

/// 带超时的子进程 output（用于 PowerShell 枚举等，避免 ensure 路径永久阻塞）。
pub fn command_output_timed(mut cmd: Command, timeout: Duration) -> Option<std::process::Output> {
    hide_console(&mut cmd);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = cmd.spawn().ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(_) => return None,
        }
    }
}

fn run_command_timed(cmd: &mut Command, timeout: Duration) -> Result<OpenClawCliResult, String> {
    let spawn_err = |e: std::io::Error| {
        if e.raw_os_error() == Some(193) {
            return "无法执行本机服务：PATH 中的运行时不是有效的 Windows 程序（常见于 npm 全局 shim）。请在设置中改回「内置版」，或重新安装本机服务组件后确认可用。".to_string();
        }
        format!("无法执行本机服务（{e}）。请确认运行时已正确安装。")
    };

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(spawn_err)?;

    let out_buf = Arc::new(Mutex::new(Vec::new()));
    let err_buf = Arc::new(Mutex::new(Vec::new()));
    let out_join = spawn_pipe_reader(child.stdout.take(), Arc::clone(&out_buf));
    let err_join = spawn_pipe_reader(child.stderr.take(), Arc::clone(&err_buf));

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    // Windows 上 child.kill 只杀启动器。openclaw.mjs 会再拉起 node 子进程，
                    // 超时后必须结束整棵树，否则 gateway stop / doctor 会一直残留。
                    #[cfg(windows)]
                    taskkill_pid(child.id());
                    let _ = child.kill();
                    // Wait up to 5s for killed process to exit, then force-drop handle
                    let kill_start = Instant::now();
                    loop {
                        match child.try_wait() {
                            Ok(Some(_)) | Err(_) => break,
                            Ok(None) => {
                                if kill_start.elapsed() > Duration::from_secs(5) {
                                    break;
                                }
                                std::thread::sleep(Duration::from_millis(50));
                            }
                        }
                    }
                    if let Some(j) = out_join {
                        let _ = j.join();
                    }
                    if let Some(j) = err_join {
                        let _ = j.join();
                    }
                    return Ok(OpenClawCliResult {
                        ok: false,
                        stdout: String::new(),
                        stderr: format!(
                            "本机服务执行超过 {} 秒，已强制终止。",
                            timeout.as_secs()
                        ),
                        exit_code: None,
                    });
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(e.to_string()),
        }
    };

    if let Some(j) = out_join {
        let _ = j.join();
    }
    if let Some(j) = err_join {
        let _ = j.join();
    }

    let out_b = out_buf.lock().map(|g| g.clone()).unwrap_or_default();
    let err_b = err_buf.lock().map(|g| g.clone()).unwrap_or_default();

    Ok(OpenClawCliResult {
        ok: status.success(),
        stdout: cap_stream(&String::from_utf8_lossy(&out_b)),
        stderr: cap_stream(&String::from_utf8_lossy(&err_b)),
        exit_code: status.code(),
    })
}

pub fn run_openclaw(args: &[&str]) -> Result<OpenClawCliResult, String> {
    run_openclaw_timed(args, Duration::from_secs(15))
}

/// Post-install smoke test for the selected runtime source.
pub fn verify_runtime_for_preference(_source: RuntimeSource) -> Result<(), String> {
    if !bundled_openclaw_ready() {
        return Err("本机服务运行时尚未就绪。".into());
    }
    let result = run_openclaw_for_source_timed(&["--version"], RuntimeSource::Bundled, Duration::from_secs(30))?;
    if !result.ok {
        let detail = if result.stderr.is_empty() {
            result.stdout
        } else {
            result.stderr
        };
        return Err(format!("本机服务验证失败：{detail}"));
    }
    Ok(())
}

/// 返回占用 `port` 的 LISTENING 进程 PID（Windows）；无则 None。
#[cfg(windows)]
fn taskkill_pid(pid: u32) {
    if is_kill_protected(pid, None) {
        return;
    }
    let mut cmd = std::process::Command::new("taskkill");
    // /T：结束进程树，避免 launcher 死后留下监听端口的 Node 子进程
    cmd.args(["/F", "/T", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    hide_console(&mut cmd);
    let _ = cmd.status();
}

/// Windows 11+ 已移除 wmic；用 PowerShell CIM 枚举 node 进程命令行。
#[cfg(windows)]
fn enumerate_node_process_command_lines() -> Vec<(u32, String)> {
    let script = r#"Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object { Write-Output ($_.ProcessId.ToString() + [char]9 + $_.CommandLine) }"#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
    ])
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::null());
    let Some(out) = command_output_timed(cmd, Duration::from_secs(12)) else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((pid_s, cmd)) = line.split_once('\t') {
            if let Ok(pid) = pid_s.trim().parse::<u32>() {
                rows.push((pid, cmd.to_string()));
            }
        }
    }
    rows
}

#[cfg(windows)]
fn is_openclaw_gateway_cmdline(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    lower.contains("openclaw.mjs")
        || (lower.contains("openclaw") && (lower.contains("gateway") || lower.contains(" run")))
}

#[cfg(windows)]
fn line_indicates_listening(line: &str) -> bool {
    let upper = line.to_uppercase();
    upper.contains("LISTENING")
        || upper.contains("LISTEN")
        || line.contains("监听")
        || line.contains("侦听")
}

#[cfg(windows)]
fn is_bundled_yuntuai_cmdline(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    lower.contains("yuntuai") && lower.contains("openclaw-portable")
}

#[cfg(windows)]
pub fn port_listening_pid(port: u16) -> Option<u32> {
    use std::io::BufRead;
    use std::time::Duration;
    let mut netstat = std::process::Command::new("netstat");
    netstat
        .args(["-ano", "-p", "tcp"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let output = command_output_timed(netstat, Duration::from_secs(5))?;
    let target = format!(":{port}");
    for line in BufReader::new(&output.stdout[..]).lines().map_while(Result::ok) {
        let line = line.trim();
        if line.contains(&target) && line_indicates_listening(line) {
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    if pid != 0 && pid != std::process::id() {
                        return Some(pid);
                    }
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
pub fn port_listening_pid(_port: u16) -> Option<u32> {
    None
}

/// 通过端口号强制终止 Windows 进程（用 taskkill /F）。
/// 用于清理前次崩溃遗留的孤儿网关进程，避免端口仍被旧进程占用。
#[cfg(windows)]
fn kill_process_by_port(port: u16) {
    use std::io::BufRead;
    let mut netstat = std::process::Command::new("netstat");
    netstat
        .args(["-ano", "-p", "tcp"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    hide_console(&mut netstat);
    let output = netstat.output().ok();
    let Some(out) = output else { return };
    let target = format!(":{port}");
    let mut pids: Vec<u32> = Vec::new();
    for line in BufReader::new(&out.stdout[..]).lines().map_while(Result::ok) {
        let line = line.trim();
        // 找 LISTENING 状态的端口
        if line.contains(&target) && line_indicates_listening(line) {
            if let Some(pid_str) = line.split_whitespace().last() {
                if let Ok(pid) = pid_str.parse::<u32>() {
                    pids.push(pid);
                }
            }
        }
    }
    for pid in pids {
        // Never force-kill the supervised gateway child via the port owner — it is managed
        // through its own Child handle. This prevents racing threads from tearing it down.
        if is_kill_protected(pid, None) {
            continue;
        }
        let mut tk = std::process::Command::new("taskkill");
        tk.args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        hide_console(&mut tk);
        let _ = tk.status();
    }
}

/// 跨平台：强制终止占用指定端口的进程（目前仅 Windows 实现）。
pub fn force_kill_port_owner(port: u16) {
    #[cfg(windows)]
    kill_process_by_port(port);
    #[cfg(not(windows))]
    let _ = port;
}

/// 清理潜在的孤儿 OpenClaw 子进程。
/// 用 wmic 找所有命令行含 openclaw.mjs 或 "openclaw gateway" 的 node.exe 进程，
/// 前次崩溃/强杀后这些进程会变成孤儿持续占用 CPU/内存。
/// 仅匹配明确的 OpenClaw 入口文件/子命令，避免误杀路径中含 "openclaw" 的非网关 node 进程。
/// `skip_pid` 可选保护：传入应跳过的 PID（如 supervisor 正在监管的子进程）。
#[cfg(windows)]
pub fn kill_orphan_openclaw_processes(skip_pid: Option<u32>) {
    let my_pid = std::process::id();
    for (pid, cmd) in enumerate_node_process_command_lines() {
        if !is_openclaw_gateway_cmdline(&cmd) {
            continue;
        }
        if pid == 0 || pid == my_pid || skip_pid == Some(pid) {
            continue;
        }
        eprintln!("[YunTuAI] kill orphan openclaw gateway pid={pid}");
        taskkill_pid(pid);
    }
}

#[cfg(not(windows))]
pub fn kill_orphan_openclaw_processes(_skip_pid: Option<u32>) {
    // Unix: pkill -f "node.*openclaw" 会杀自己，不实现
}

/// 仅终止**非 YunTuAI 内置**的 OpenClaw 网关（PATH 全局安装、~/.openclaw 计划任务等）。
#[cfg(windows)]
pub fn kill_external_openclaw_gateways(protect_pid: Option<u32>) {
    stop_windows_gateway_scheduled_task();
    let my_pid = std::process::id();
    for (pid, cmd) in enumerate_node_process_command_lines() {
        if !is_openclaw_gateway_cmdline(&cmd) {
            continue;
        }
        if is_bundled_yuntuai_cmdline(&cmd) {
            continue;
        }
        if pid == 0 || pid == my_pid || protect_pid == Some(pid) {
            continue;
        }
        eprintln!("[YunTuAI] suppress external openclaw gateway pid={pid}");
        taskkill_pid(pid);
    }
}

#[cfg(not(windows))]
pub fn kill_external_openclaw_gateways(_protect_pid: Option<u32>) {}

/// 应用启动 / 连接前：结束外部守护并清理非监管网关进程，保留 YunTuAI 监管子进程。
pub fn suppress_external_openclaw(protect_pid: Option<u32>) {
    kill_external_openclaw_gateways(protect_pid);
    let port = crate::openclaw::read_gateway_listen_endpoint()
        .map(|(_, p)| p)
        .unwrap_or(18789);
    if !crate::openclaw::gateway_port_reachable() {
        return;
    }
    let Some(owner) = port_listening_pid(port) else {
        return;
    };
    if protect_pid == Some(owner) {
        return;
    }
    eprintln!(
        "[YunTuAI] port {port} held by unsupervised pid={owner} (protect={protect_pid:?}), reclaiming"
    );
    force_kill_port_owner(port);
    kill_orphan_openclaw_processes(protect_pid);
}

/// Stop gateway processes from every available runtime (before switching source).
pub fn stop_all_gateways() {
    #[cfg(windows)]
    stop_windows_gateway_scheduled_task();

    if bundled_openclaw_ready() {
        let _ = run_openclaw_for_source_timed(
            &["gateway", "stop"],
            RuntimeSource::Bundled,
            Duration::from_secs(12),
        );
    }
    if probe_global_openclaw().0 {
        let _ = run_openclaw_for_source_timed(
            &["gateway", "stop"],
            RuntimeSource::Global,
            Duration::from_secs(12),
        );
    }

    let port = crate::openclaw::read_gateway_listen_endpoint()
        .map(|(_, p)| p)
        .unwrap_or(18789);
    force_kill_port_owner(port);
    kill_orphan_openclaw_processes(None);
}

#[cfg(windows)]
fn stop_windows_gateway_scheduled_task() {
    let mut end = std::process::Command::new("schtasks");
    end.args(["/End", "/TN", "OpenClaw Gateway"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    hide_console(&mut end);
    let _ = end.status();
    let mut disable = std::process::Command::new("schtasks");
    disable
        .args(["/Change", "/TN", "OpenClaw Gateway", "/DISABLE"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    hide_console(&mut disable);
    let _ = disable.status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_npm_env_skipped_for_global() {
        assert!(should_apply_bundled_npm_env(RuntimeSource::Bundled));
        assert!(should_apply_bundled_npm_env(RuntimeSource::Global));
    }

    #[test]
    fn managed_gateway_pid_roundtrip_and_protection() {
        // The supervised gateway PID must be honored by the blunt killers so racing
        // background threads can never tear down the current managed gateway.
        set_managed_gateway_pid(None);
        assert_eq!(managed_gateway_pid(), None);
        assert!(!is_kill_protected(123_456, None));

        set_managed_gateway_pid(Some(123_456));
        assert_eq!(managed_gateway_pid(), Some(123_456));
        assert!(is_kill_protected(123_456, None), "managed pid must be protected");

        // PID 0, our own process, and an explicit skip pid are always protected.
        assert!(is_kill_protected(0, None));
        assert!(is_kill_protected(std::process::id(), None));
        assert!(is_kill_protected(999, Some(999)));

        // An unrelated PID is not protected while a different managed PID is set.
        assert!(!is_kill_protected(654_321, None));

        // Cleanup so this shared global does not leak into other tests.
        set_managed_gateway_pid(None);
        assert_eq!(managed_gateway_pid(), None);
    }
}
