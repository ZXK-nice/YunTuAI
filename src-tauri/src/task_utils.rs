//! Lightweight utility for long-running operations: timeout wrapping and progress emission.
//! Use `with_timeout` to run a blocking closure with a deadline; use `ProgressEmitter` to
//! stream phase/percentage updates to the frontend via Tauri events.
#![allow(dead_code)]

use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Run a blocking closure with a deadline. Spawns the closure on a dedicated OS thread;
/// returns an error if the thread does not complete within `timeout`.
pub fn with_timeout<T: Send + 'static>(
    label: &str,
    timeout: Duration,
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let label_owned = label.to_string();
    match std::thread::Builder::new()
        .name(format!("yuntuai-timeout-{label}"))
        .spawn(move || {
            let _ = tx.send(f());
        }) {
        Ok(_) => {}
        Err(e) => return Err(format!("{label} 启动超时线程失败: {e}")),
    }
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            Err(format!("{label_owned} 超时（{}s）", timeout.as_secs()))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err(format!("{label_owned} 执行线程异常退出"))
        }
    }
}

/// A simple progress emitter that pushes structured updates to the frontend
/// via the `yuntuai-task-progress` Tauri event.
///
/// Use this from long-running IPC commands so the UI can show a progress bar
/// instead of appearing frozen.
pub struct ProgressEmitter {
    app: AppHandle,
    task_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgressEvent {
    pub task_id: String,
    pub phase: String,
    pub percent: u8,
    pub message: String,
}

impl ProgressEmitter {
    pub fn new(app: AppHandle, task_id: &str) -> Self {
        Self {
            app,
            task_id: task_id.to_string(),
        }
    }

    pub fn emit(&self, phase: &str, percent: u8, message: &str) {
        let _ = self.app.emit(
            "yuntuai-task-progress",
            TaskProgressEvent {
                task_id: self.task_id.clone(),
                phase: phase.to_string(),
                percent,
                message: message.to_string(),
            },
        );
    }
}
