//! 应用退出信号，供各后台线程在 shutdown 时尽快退出，避免托盘退出卡死。

use std::sync::atomic::{AtomicBool, Ordering};

static SHUTDOWN_SIGNAL: AtomicBool = AtomicBool::new(false);

pub fn signal_app_shutdown() {
    SHUTDOWN_SIGNAL.store(true, Ordering::SeqCst);
}

pub fn is_app_shutting_down() -> bool {
    SHUTDOWN_SIGNAL.load(Ordering::Relaxed)
}
