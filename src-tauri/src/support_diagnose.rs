//! 运行 bundled `diagnose-yuntuai.ps1` 并将报告保存到安装目录 `diagnostics/`。

use chrono::Local;
use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::paths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnoseReportResult {
    pub ok: bool,
    pub report_path: Option<String>,
    pub exit_code: Option<i32>,
    pub stdout_tail: String,
    pub error: Option<String>,
}

fn bundled_support_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bundled")
        .join("support")
}

fn resolve_diagnose_script() -> Option<PathBuf> {
    let script_name = "diagnose-yuntuai.ps1";
    if let Some(exe) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        for candidate in [
            exe.join("bundled").join("support").join(script_name),
            exe.join("resources").join("bundled").join("support").join(script_name),
            exe.join("_up_").join("bundled").join("support").join(script_name),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let dev = bundled_support_dir().join(script_name);
    if dev.is_file() {
        return Some(dev);
    }
    None
}

fn parse_report_path(stdout: &str) -> Option<PathBuf> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("报告已保存:") {
            let p = rest.trim();
            if !p.is_empty() {
                return Some(PathBuf::from(p));
            }
        }
    }
    None
}

fn default_report_path() -> Result<PathBuf, String> {
    let root = paths::installed_dir()?;
    let dir = root.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建诊断目录: {e}"))?;
    let name = format!(
        "YunTuAI-diagnose-{}.txt",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    Ok(dir.join(name))
}

/// 执行诊断脚本；报告写入 `{InstallDir}\diagnostics\`。
pub fn run_diagnose_save_report() -> DiagnoseReportResult {
    let report_path = match default_report_path() {
        Ok(p) => p,
        Err(e) => {
            return DiagnoseReportResult {
                ok: false,
                report_path: None,
                exit_code: None,
                stdout_tail: String::new(),
                error: Some(e),
            };
        }
    };

    let script = match resolve_diagnose_script() {
        Some(p) => p,
        None => {
            return DiagnoseReportResult {
                ok: false,
                report_path: None,
                exit_code: None,
                stdout_tail: String::new(),
                error: Some("未找到 diagnose-yuntuai.ps1".into()),
            };
        }
    };

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
        "-ReportFile",
        &report_path.to_string_lossy(),
    ]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::openclaw_exec::hide_console(&mut cmd);

    const DIAGNOSE_TIMEOUT: Duration = Duration::from_secs(120);

    match cmd.spawn() {
        Ok(mut child) => {
            let stdout_pipe = child.stdout.take();
            let stderr_pipe = child.stderr.take();
            let started = Instant::now();
            let wait_result = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Ok(status),
                    Ok(None) => {
                        if started.elapsed() >= DIAGNOSE_TIMEOUT {
                            let _ = child.kill();
                            let _ = child.wait();
                            break Err("诊断脚本超时（120s），已终止".to_string());
                        }
                        std::thread::sleep(Duration::from_millis(200));
                    }
                    Err(e) => break Err(format!("等待诊断脚本失败: {e}")),
                }
            };

            let mut stdout = String::new();
            if let Some(mut pipe) = stdout_pipe {
                let _ = pipe.read_to_string(&mut stdout);
            }
            let mut stderr = String::new();
            if let Some(mut pipe) = stderr_pipe {
                let _ = pipe.read_to_string(&mut stderr);
            }
            let stderr = stderr.trim().to_string();

            match wait_result {
                Ok(exit_status) => {
                    let exit_code = exit_status.code();
                    let report_path = parse_report_path(&stdout)
                        .filter(|p| p.is_file())
                        .or_else(|| {
                            if report_path.is_file() {
                                Some(report_path.clone())
                            } else {
                                None
                            }
                        })
                        .map(|p| p.to_string_lossy().to_string());
                    let ok = report_path.is_some();
                    let stdout_tail: String = stdout
                        .chars()
                        .rev()
                        .take(2_000)
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                    DiagnoseReportResult {
                        ok,
                        report_path,
                        exit_code,
                        stdout_tail,
                        error: if ok {
                            None
                        } else if !stderr.is_empty() {
                            Some(stderr)
                        } else {
                            Some("诊断脚本未生成报告文件".into())
                        },
                    }
                }
                Err(msg) => DiagnoseReportResult {
                    ok: false,
                    report_path: None,
                    exit_code: None,
                    stdout_tail: String::new(),
                    error: Some(msg),
                },
            }
        }
        Err(e) => DiagnoseReportResult {
            ok: false,
            report_path: None,
            exit_code: None,
            stdout_tail: String::new(),
            error: Some(format!("启动诊断脚本失败: {e}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_report_path_from_stdout() {
        let out = "line1\n报告已保存: H:\\YunTuAI\\diagnostics\\YunTuAI-diagnose-20260729.txt\n";
        let p = parse_report_path(out).expect("path");
        assert!(p.to_string_lossy().contains("diagnostics"));
    }

    #[test]
    fn default_report_path_is_under_diagnostics() {
        let p = default_report_path().expect("path");
        let s = p.to_string_lossy();
        assert!(s.contains("diagnostics"));
        assert!(s.contains("YunTuAI-diagnose-"));
    }
}
