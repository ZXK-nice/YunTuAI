//! 把会做磁盘 / 网络 / 子进程的 IPC 从 WebView UI 线程挪走，避免窗口「未响应」。

pub async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("后台任务失败: {e}"))?
}
