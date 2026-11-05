//! OpenClaw 便携运行时路径：Windows / macOS 共用结构，可执行文件名不同。

use std::path::{Path, PathBuf};

pub(crate) fn openclaw_launcher_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "openclaw.cmd"
    } else {
        "openclaw.sh"
    }
}

pub(crate) fn node_runtime_executable(portable_dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        portable_dir.join("node-runtime").join("node.exe")
    } else {
        portable_dir.join("node-runtime").join("bin").join("node")
    }
}

pub(crate) fn openclaw_mjs_path(portable_dir: &Path) -> PathBuf {
    portable_dir
        .join("npm-prefix")
        .join("node_modules")
        .join("openclaw")
        .join("openclaw.mjs")
}

pub(crate) fn portable_runtime_ready(portable_dir: &Path) -> bool {
    node_runtime_executable(portable_dir).is_file() && openclaw_mjs_path(portable_dir).is_file()
}
