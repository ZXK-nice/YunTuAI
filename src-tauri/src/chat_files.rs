//! 对话附件：产出目录、上传落盘、打开文件、扫描 AI 新生成文件。

use crate::auth::assert_authenticated;
use crate::db::DbState;
use crate::openclaw_control::{managed_openclaw_data_dir, resolve_workspace_dir};
use crate::openclaw_runtime::strip_bom;
use crate::paths;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;
use zip::read::ZipArchive;

const OUTPUT_CONFIG: &str = "chat-output-dir.json";
const MAX_UPLOAD_BYTES: u64 = 48 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES: u64 = 512 * 1024;
const MAX_OFFICE_EXTRACT_IMAGES: usize = 12;
const MAX_OFFICE_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_OFFICE_TEXT_PREVIEW_CHARS: usize = 24_000;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputDirConfig {
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSavedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUploadEntry {
    pub name: String,
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedDroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
}

fn is_probably_text_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        ".md", ".txt", ".json", ".js", ".ts", ".tsx", ".jsx", ".py", ".rs", ".html", ".css",
        ".xml", ".yaml", ".yml", ".csv", ".log", ".ini", ".toml", ".env",
    ]
    .iter()
    .any(|ext| lower.ends_with(ext))
}

fn validate_file_path(path: &str) -> Result<PathBuf, String> {
    validate_attachment_ingest_path(path)
}

/// 用户拖拽/选文件入库：禁止 `..` 与常见系统目录，仍允许桌面等用户路径。
fn validate_attachment_ingest_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }
    let p = PathBuf::from(trimmed);
    if path_has_parent_traversal(&p) {
        return Err("路径不允许包含 ..".into());
    }
    if !p.is_file() {
        return Err(format!("不是有效文件: {}", p.display()));
    }
    let canon = p
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {e}"))?;
    if is_blocked_system_path(&canon) {
        return Err("不允许读取系统目录中的文件".into());
    }
    let size = canon.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_UPLOAD_BYTES {
        return Err(format!(
            "文件 {} 超过 {}MB 上限",
            canon
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| trimmed.into()),
            MAX_UPLOAD_BYTES / 1024 / 1024
        ));
    }
    Ok(canon)
}

/// 已入库/工作区读取：必须在允许根目录内。
fn validate_sandboxed_read_path(path: &str) -> Result<PathBuf, String> {
    let p = assert_user_openable_path(&PathBuf::from(path.trim()), false)?;
    let size = p.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_UPLOAD_BYTES {
        return Err(format!(
            "文件 {} 超过 {}MB 上限",
            p.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.into()),
            MAX_UPLOAD_BYTES / 1024 / 1024
        ));
    }
    Ok(p)
}

fn is_blocked_system_path(path: &Path) -> bool {
    let s = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    [
        "\\windows\\system32",
        "\\windows\\syswow64",
        "\\program files\\windowsapps\\",
        "\\program files\\",
        "\\program files (x86)\\",
    ]
    .iter()
    .any(|needle| s.contains(needle))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(paths::data_dir()?.join(OUTPUT_CONFIG))
}

fn default_output_dir() -> Result<PathBuf, String> {
    let data = managed_openclaw_data_dir()?;
    let p = resolve_workspace_dir(&data)?.join("output");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

pub fn resolve_output_dir() -> Result<PathBuf, String> {
    let cfg = config_path()?;
    if cfg.is_file() {
        if let Ok(raw) = fs::read_to_string(&cfg) {
            if let Ok(c) = serde_json::from_str::<OutputDirConfig>(strip_bom(&raw)) {
                let p = PathBuf::from(c.path.trim());
                if p.is_dir() {
                    return normalize_output_path(&p);
                }
            }
        }
    }
    let default = default_output_dir()?;
    normalize_output_path(&default)
}

/// Windows 下统一去掉 `\\?\` 等前缀，避免 junction 与目标目录比较失败。
fn normalize_output_path(path: &Path) -> Result<PathBuf, String> {
    let canon = path
        .canonicalize()
        .map_err(|e| format!("无法解析产出目录: {e}"))?;
    Ok(strip_verbatim_path_prefix(&canon))
}

#[cfg(windows)]
fn strip_verbatim_path_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

#[cfg(not(windows))]
fn strip_verbatim_path_prefix(path: &Path) -> PathBuf {
    path.to_path_buf()
}

fn same_canonical_path(a: &Path, b: &Path) -> bool {
    match (
        a.canonicalize().ok().map(|p| strip_verbatim_path_prefix(&p)),
        b.canonicalize().ok().map(|p| strip_verbatim_path_prefix(&p)),
    ) {
        (Some(ca), Some(cb)) => ca == cb,
        _ => false,
    }
}

fn merge_dir_into(dest: &Path, src: &Path) -> Result<(), String> {
    if !src.is_dir() {
        return Ok(());
    }
    if same_canonical_path(dest, src) {
        return Ok(());
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let to = dest.join(name);
        if ft.is_dir() {
            merge_dir_into(&to, &entry.path())?;
            let _ = fs::remove_dir_all(entry.path());
        } else if ft.is_file() {
            if to.exists() {
                let _ = fs::remove_file(&to);
            }
            fs::rename(entry.path(), &to).or_else(|_| {
                fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
                fs::remove_file(entry.path()).map_err(|e| e.to_string())
            })?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_path_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    path.symlink_metadata()
        .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_path_reparse_point(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(windows)]
fn create_windows_output_junction(link: &Path, user: &Path) -> Result<(), String> {
    let cmd_line = format!(
        "mklink /J \"{}\" \"{}\"",
        link.display(),
        user.display()
    );
    let status = std::process::Command::new("cmd")
        .args(["/C", &cmd_line])
        .status()
        .map_err(|e| format!("创建产出目录联接失败: {e}"))?;
    if !status.success() {
        return Err("mklink /J 失败".into());
    }
    if !same_canonical_path(link, user) {
        let _ = remove_workspace_output_link(link);
        return Err(format!(
            "产出目录联接校验失败（目标应为 {}）",
            user.display()
        ));
    }
    Ok(())
}

/// 将 `workspace/output` 联接/同步到用户产出目录，Agent 写 `output/` 即落到用户指定位置。
fn sync_workspace_output_junction(user_dir: &Path) -> Result<(), String> {
    let user = normalize_output_path(user_dir)?;
    fs::create_dir_all(&user).map_err(|e| e.to_string())?;

    let data = managed_openclaw_data_dir()?;
    let ws = resolve_workspace_dir(&data)?;
    fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
    let link = ws.join("output");

    if link.exists() {
        if same_canonical_path(&link, &user) {
            write_workspace_output_marker(&ws, &user)?;
            return Ok(());
        }
        // 错误联接（如路径含空格指到 Desktop）绝不能 merge，否则会套娃复制同名文件夹。
        if is_path_reparse_point(&link) {
            remove_workspace_output_link(&link)?;
        } else if link.is_dir() {
            merge_dir_into(&user, &link)?;
            remove_workspace_output_link(&link)?;
        } else {
            fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(windows)]
    {
        match create_windows_output_junction(&link, &user) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("[YunTuAI] output junction: {e}");
                write_workspace_output_marker(&ws, &user)?;
                return Ok(());
            }
        }
    }

    #[cfg(not(windows))]
    {
        std::os::unix::fs::symlink(&user, &link).map_err(|e| format!("创建产出目录符号链接失败: {e}"))?;
    }

    write_workspace_output_marker(&ws, &user)?;
    Ok(())
}

/// 应用启动时一次性修复 workspace/output 联接（读取设置时不再重复同步，避免热路径递归）。
pub fn repair_output_workspace_link() {
    if let Ok(dir) = resolve_output_dir() {
        if let Err(e) = sync_workspace_output_junction(&dir) {
            eprintln!("[YunTuAI] repair output junction: {e}");
        }
    }
}

fn write_workspace_output_marker(workspace: &Path, user_dir: &Path) -> Result<(), String> {
    let marker = workspace.join("YUNTU_OUTPUT_DIR.txt");
    let body = format!(
        "YunTuAI 用户产出目录（最终文件请保存到 output/ 或此绝对路径）：\n{}\n",
        user_dir.display()
    );
    fs::write(marker, body).map_err(|e| e.to_string())?;
    Ok(())
}

fn sanitize_filename(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    let base = normalized.split('/').next_back().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._-()（）".contains(c) || ('\u{4e00}'..='\u{9fff}').contains(&c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let t = cleaned.trim();
    if t.is_empty() {
        "file".to_string()
    } else {
        t.chars().take(160).collect()
    }
}

/// 校验 batchId：仅允许安全字符（字母/数字/下划线/连字符），防止 `..`、路径分隔符
/// 等被用于跨目录写入（路径穿越）。UI 侧使用 UUID，此处为 IPC 层的纵深防御。
fn validate_batch_id(batch_id: &str) -> Result<String, String> {
    let batch = batch_id.trim();
    if batch.is_empty() {
        return Err("batchId 不能为空".into());
    }
    if batch.len() > 64 {
        return Err("batchId 过长".into());
    }
    if !batch.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("batchId 含非法字符（仅允许字母、数字、下划线、连字符）".into());
    }
    Ok(batch.to_string())
}

fn copy_into_workspace_inbox(batch_id: &str, files: &[ChatSavedFile]) -> Result<(), String> {
    let data = managed_openclaw_data_dir()?;
    let ws = resolve_workspace_dir(&data)?
        .join("inbox")
        .join(batch_id);
    fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
    for f in files {
        let src = PathBuf::from(&f.path);
        if src.is_file() {
            let dest = ws.join(sanitize_filename(&f.name));
            fs::copy(&src, &dest).map_err(|e| format!("无法复制到工作区：{}（{e}）", f.name))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn chat_get_output_dir(state: State<'_, DbState>, token: String) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    Ok(resolve_output_dir()?.to_string_lossy().to_string())
}

fn validate_output_dir_choice(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("路径为空".into());
    }
    if path_has_parent_traversal(path) {
        return Err("路径不允许包含 ..".into());
    }
    if !path.is_dir() {
        return Err("路径不存在或不是文件夹".into());
    }
    let canon = path
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {e}"))?;
    if is_blocked_system_path(&canon) {
        return Err("不允许使用系统目录作为产出目录".into());
    }
    if !is_writable_output_dir(&canon) {
        return Err("该文件夹不可写，请选择有写入权限的目录".into());
    }
    Ok(canon)
}

fn is_writable_output_dir(path: &Path) -> bool {
    let probe = path.join(".yuntu_output_write_probe");
    match fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

#[cfg(windows)]
fn remove_workspace_output_link(link: &Path) -> Result<(), String> {
    if !link.exists() {
        return Ok(());
    }
    // 目录联接（mklink /J）不能用 remove_dir_all，否则会误删目标目录内容。
    let rmdir = std::process::Command::new("cmd")
        .args(["/C", "rmdir", "/Q", &link.to_string_lossy()])
        .status()
        .map_err(|e| format!("删除 workspace/output 联接失败: {e}"))?;
    if rmdir.success() {
        return Ok(());
    }
    if link.is_symlink() {
        fs::remove_file(link).map_err(|e| e.to_string())?;
        return Ok(());
    }
    if link.is_dir() {
        fs::remove_dir(link)
            .or_else(|_| fs::remove_dir_all(link))
            .map_err(|e| format!("删除旧 output 目录失败: {e}"))?;
    } else {
        fs::remove_file(link).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn remove_workspace_output_link(link: &Path) -> Result<(), String> {
    if !link.exists() {
        return Ok(());
    }
    if link.is_symlink() {
        fs::remove_file(link).map_err(|e| e.to_string())?;
    } else if link.is_dir() {
        fs::remove_dir_all(link).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(link).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn chat_set_output_dir(
    state: State<'_, DbState>,
    token: String,
    path: String,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    let p = validate_output_dir_choice(Path::new(path.trim()))?;
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    let normalized = normalize_output_path(&p)?;
    let cfg = OutputDirConfig {
        path: normalized.to_string_lossy().to_string(),
    };
    let raw = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(config_path()?, raw).map_err(|e| e.to_string())?;
    sync_workspace_output_junction(&normalized)?;
    Ok(cfg.path)
}

#[tauri::command]
pub fn chat_pick_output_folder(
    state: State<'_, DbState>,
    token: String,
) -> Result<Option<String>, String> {
    assert_authenticated(&state, &token)?;
    let picked = rfd::FileDialog::new()
        .set_title("选择文件夹")
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn chat_save_upload_files(
    state: State<'_, DbState>,
    token: String,
    batch_id: String,
    files: Vec<ChatUploadEntry>,
    copy_to_workspace: Option<bool>,
) -> Result<Vec<ChatSavedFile>, String> {
    assert_authenticated(&state, &token)?;
    let copy = copy_to_workspace.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || save_upload_files_blocking(batch_id, files, copy))
        .await
        .map_err(|e| format!("保存上传失败: {e}"))?
}

fn save_upload_files_blocking(
    batch_id: String,
    files: Vec<ChatUploadEntry>,
    copy_to_workspace: bool,
) -> Result<Vec<ChatSavedFile>, String> {
    let batch = validate_batch_id(&batch_id)?;
    let out_root = resolve_output_dir()?;
    let dir = out_root.join("_uploads").join(&batch);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let engine = base64::engine::general_purpose::STANDARD;
    let mut saved = Vec::new();
    for entry in files {
        let name = sanitize_filename(&entry.name);
        let bytes = engine
            .decode(entry.data_base64.as_bytes())
            .map_err(|e| format!("解码 {name}: {e}"))?;
        if bytes.len() as u64 > MAX_UPLOAD_BYTES {
            return Err(format!("文件 {name} 超过 {}MB 上限", MAX_UPLOAD_BYTES / 1024 / 1024));
        }
        let path = dir.join(&name);
        fs::write(&path, &bytes).map_err(|e| format!("写入 {name}: {e}"))?;
        saved.push(ChatSavedFile {
            name,
            path: path.to_string_lossy().to_string(),
            size: bytes.len() as u64,
        });
    }
    if copy_to_workspace {
        let _ = copy_into_workspace_inbox(&batch, &saved);
    }
    Ok(saved)
}

fn mime_for_image_name(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        return Some("image/png");
    }
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        return Some("image/jpeg");
    }
    if lower.ends_with(".gif") {
        return Some("image/gif");
    }
    if lower.ends_with(".webp") {
        return Some("image/webp");
    }
    if lower.ends_with(".bmp") {
        return Some("image/bmp");
    }
    None
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatFileBase64Payload {
    pub base64: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTextPreviewPayload {
    pub name: String,
    pub content: String,
    pub truncated: bool,
}

#[tauri::command]
pub async fn chat_read_text_preview(
    state: State<'_, DbState>,
    token: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<ChatTextPreviewPayload, String> {
    assert_authenticated(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || read_text_preview_blocking(path, max_bytes))
        .await
        .map_err(|e| format!("读取预览失败: {e}"))?
}

fn read_text_preview_blocking(
    path: String,
    max_bytes: Option<u64>,
) -> Result<ChatTextPreviewPayload, String> {
    let p = validate_sandboxed_read_path(&path)?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    if !is_probably_text_name(&name) {
        return Err(format!("不支持预览此类型文件: {name}"));
    }
    let meta = p.metadata().map_err(|e| e.to_string())?;
    let cap = max_bytes.unwrap_or(64 * 1024).min(MAX_TEXT_PREVIEW_BYTES);
    if meta.len() > MAX_TEXT_PREVIEW_BYTES {
        return Err(format!("文件过大，无法预览（上限 {}KB）", MAX_TEXT_PREVIEW_BYTES / 1024));
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let truncated = bytes.len() as u64 > cap;
    let slice = if truncated {
        &bytes[..cap as usize]
    } else {
        &bytes[..]
    };
    let content = String::from_utf8(slice.to_vec())
        .map_err(|_| "文件不是有效的 UTF-8 文本".to_string())?;
    Ok(ChatTextPreviewPayload {
        name,
        content,
        truncated,
    })
}

#[tauri::command]
pub async fn chat_read_file_base64(
    state: State<'_, DbState>,
    token: String,
    path: String,
) -> Result<ChatFileBase64Payload, String> {
    assert_authenticated(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || read_file_base64_blocking(path))
        .await
        .map_err(|e| format!("读取文件失败: {e}"))?
}

fn read_file_base64_blocking(path: String) -> Result<ChatFileBase64Payload, String> {
    let p = validate_sandboxed_read_path(&path)?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let mime = mime_for_image_name(&name).ok_or_else(|| format!("不是支持的图片文件: {name}"))?;
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Err(format!("文件 {name} 超过 {}MB 上限", MAX_UPLOAD_BYTES / 1024 / 1024));
    }
    let engine = base64::engine::general_purpose::STANDARD;
    Ok(ChatFileBase64Payload {
        base64: engine.encode(bytes),
        mime_type: mime.to_string(),
    })
}

#[tauri::command]
pub async fn chat_inspect_dropped_paths(
    state: State<'_, DbState>,
    token: String,
    paths: Vec<String>,
) -> Result<Vec<InspectedDroppedFile>, String> {
    assert_authenticated(&state, &token)?;
    tauri::async_runtime::spawn_blocking(move || inspect_dropped_paths_impl(paths))
        .await
        .map_err(|e| e.to_string())?
}

fn inspect_dropped_paths_impl(paths: Vec<String>) -> Result<Vec<InspectedDroppedFile>, String> {
    let mut out = Vec::new();
    for raw in paths {
        let p = validate_file_path(&raw)?;
        let raw_name = p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        let name = sanitize_filename(&raw_name);
        let size = p.metadata().map(|m| m.len()).unwrap_or(0);
        let path_str = p.to_string_lossy().to_string();
        let is_text = is_probably_text_name(&name);
        let mut text_content = None;
        if is_text && size <= MAX_TEXT_PREVIEW_BYTES {
            if let Ok(bytes) = fs::read(&p) {
                text_content = String::from_utf8(bytes).ok();
            }
        }
        let kind = if text_content.is_some() {
            "text".to_string()
        } else {
            "binary".to_string()
        };
        out.push(InspectedDroppedFile {
            name,
            path: path_str,
            size,
            kind,
            text_content,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn chat_save_upload_paths(
    state: State<'_, DbState>,
    token: String,
    batch_id: String,
    paths: Vec<String>,
    copy_to_workspace: Option<bool>,
) -> Result<Vec<ChatSavedFile>, String> {
    assert_authenticated(&state, &token)?;
    let copy = copy_to_workspace.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || save_upload_paths_blocking(batch_id, paths, copy))
        .await
        .map_err(|e| format!("保存上传失败: {e}"))?
}

fn save_upload_paths_blocking(
    batch_id: String,
    paths: Vec<String>,
    copy_to_workspace: bool,
) -> Result<Vec<ChatSavedFile>, String> {
    let batch = validate_batch_id(&batch_id)?;
    let out_root = resolve_output_dir()?;
    let dir = out_root.join("_uploads").join(&batch);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut saved = Vec::new();
    for raw in paths {
        let src = validate_file_path(&raw)?;
        let raw_name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        let name = sanitize_filename(&raw_name);
        let dest = dir.join(&name);
        fs::copy(&src, &dest).map_err(|e| format!("复制 {name}: {e}"))?;
        let size = dest.metadata().map(|m| m.len()).unwrap_or(0);
        saved.push(ChatSavedFile {
            name,
            path: dest.to_string_lossy().to_string(),
            size,
        });
    }
    if copy_to_workspace {
        let _ = copy_into_workspace_inbox(&batch, &saved);
    }
    Ok(saved)
}

fn path_has_parent_traversal(p: &Path) -> bool {
    p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
}

fn path_under_dir(path: &Path, dir: &Path) -> bool {
    path.canonicalize()
        .ok()
        .and_then(|p| dir.canonicalize().ok().map(|d| p.starts_with(d)))
        .unwrap_or_else(|| path.starts_with(dir))
}

fn allowed_open_roots() -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Ok(p) = resolve_output_dir() {
        roots.push(p);
    }
    if let Ok(data) = managed_openclaw_data_dir() {
        if let Ok(ws) = resolve_workspace_dir(&data) {
            roots.push(ws);
        }
    }
    if let Ok(app) = paths::data_dir() {
        roots.push(app);
    }
    #[cfg(windows)]
    {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let profile = PathBuf::from(profile);
            for sub in ["Desktop", "Documents", "Downloads", "Pictures"] {
                roots.push(profile.join(sub));
            }
        }
        if let Ok(temp) = std::env::var("TEMP") {
            roots.push(PathBuf::from(temp));
        }
    }
    if roots.is_empty() {
        return Err("无法解析允许访问的路径根目录".into());
    }
    Ok(roots)
}

/// 限制 chat_open_file / reveal_path 仅能访问产出目录、workspace 与应用数据目录。
fn assert_user_openable_path(path: &Path, allow_create: bool) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("路径为空".into());
    }
    if path_has_parent_traversal(path) {
        return Err("路径不允许包含 ..".into());
    }

    let roots = allowed_open_roots()?;

    if path.exists() {
        let canon = path
            .canonicalize()
            .map_err(|e| format!("无法解析路径: {e}"))?;
        if roots.iter().any(|root| path_under_dir(&canon, root)) {
            return Ok(canon);
        }
        return Err("无权访问该路径".into());
    }

    if !allow_create {
        return Err("文件不存在".into());
    }

    let mut probe = path.to_path_buf();
    loop {
        if probe.exists() {
            let canon = probe
                .canonicalize()
                .map_err(|e| format!("无法解析路径: {e}"))?;
            if roots.iter().any(|root| path_under_dir(&canon, root)) {
                return Ok(path.to_path_buf());
            }
            return Err("无权访问该路径".into());
        }
        if !probe.pop() {
            return Err("无权访问该路径".into());
        }
    }
}

fn open_path_with_os_app(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "start", "", &path.to_string_lossy()]);
        crate::openclaw_exec::hide_console(&mut cmd);
        cmd.spawn()
            .map_err(|e| format!("无法打开文件: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开文件: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("无法打开文件: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = path;
        Err("当前平台不支持打开文件".into())
    }
}

#[tauri::command]
pub fn chat_open_file(state: State<'_, DbState>, token: String, path: String) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    let p = assert_user_openable_path(&PathBuf::from(path.trim()), false)?;
    if !p.is_file() {
        return Err("文件不存在".into());
    }
    open_path_with_os_app(&p)
}

/// 在系统文件管理器中打开路径（目录或文件）。
#[tauri::command]
pub fn reveal_path_in_os_cmd(
    state: State<'_, DbState>,
    token: String,
    path: String,
) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }
    let p = assert_user_openable_path(&PathBuf::from(trimmed), true)?;
    if p.is_file() {
        return open_path_with_os_app(&p);
    }
    if !p.exists() {
        fs::create_dir_all(&p).map_err(|e| format!("无法创建目录 {}: {e}", p.display()))?;
    }
    open_path_with_os_app(&p)
}

fn modified_ms(path: &Path) -> Option<u64> {
    let modified = path.metadata().ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn scan_dir_since(dir: &Path, since_ms: u64, skip_uploads: bool, out: &mut Vec<ChatSavedFile>) {
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for entry in read.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_uploads && name == "_uploads" {
            continue;
        }
        if path.is_dir() {
            scan_dir_since(&path, since_ms, false, out);
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let Some(ms) = modified_ms(&path) else {
            continue;
        };
        if ms + 500 < since_ms {
            continue;
        }
        let size = path.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(ChatSavedFile {
            name,
            path: path.to_string_lossy().to_string(),
            size,
        });
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeExtractResult {
    pub kind: String,
    pub slide_count: u32,
    pub text_preview: String,
    pub image_paths: Vec<String>,
    pub image_only: bool,
    pub ocr_preview: String,
}

fn decode_basic_xml_entities(raw: &str) -> String {
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn extract_xml_text_tags(xml: &str, open_tag: &str, close_tag: &str) -> String {
    let mut out = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find(open_tag) {
        let after_open = &rest[start + open_tag.len()..];
        let Some(gt) = after_open.find('>') else {
            break;
        };
        let content_start = gt + 1;
        let Some(close_rel) = after_open[content_start..].find(close_tag) else {
            break;
        };
        let text = decode_basic_xml_entities(after_open[content_start..content_start + close_rel].trim());
        if !text.is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&text);
        }
        rest = &after_open[content_start + close_rel + close_tag.len()..];
    }
    out
}

fn is_office_image_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".bmp")
}

fn extract_zip_entry(archive: &mut ZipArchive<File>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("读取压缩项 {name}: {e}"))?;
    let mut buf = Vec::new();
    entry
        .read_to_end(&mut buf)
        .map_err(|e| format!("解压 {name}: {e}"))?;
    Ok(buf)
}

fn extract_pptx_context(
    path: &Path,
    export_dir: &Path,
    skip_ocr: bool,
) -> Result<OfficeExtractResult, String> {
    let file = File::open(path).map_err(|e| format!("无法打开 PPTX: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("不是有效的 PPTX 压缩包: {e}"))?;

    let mut slide_entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut media_entries: Vec<(String, Vec<u8>)> = Vec::new();

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 PPTX 条目失败: {e}"))?;
        let name = entry.name().to_string();
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") {
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("解压 {name}: {e}"))?;
            slide_entries.push((name, buf));
        } else if name.starts_with("ppt/media/") && is_office_image_name(&name) {
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("解压 {name}: {e}"))?;
            if buf.len() as u64 <= MAX_OFFICE_IMAGE_BYTES {
                media_entries.push((name, buf));
            }
        }
    }

    slide_entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut text_parts: Vec<String> = Vec::new();
    for (idx, (_, xml_bytes)) in slide_entries.iter().enumerate() {
        let xml = String::from_utf8_lossy(xml_bytes);
        let slide_text = extract_xml_text_tags(&xml, "<a:t", "</a:t>");
        if !slide_text.trim().is_empty() {
            text_parts.push(format!("【第{}页】\n{}", idx + 1, slide_text.trim()));
        }
    }

    fs::create_dir_all(export_dir).map_err(|e| e.to_string())?;
    let mut image_paths: Vec<String> = Vec::new();
    for (name, bytes) in media_entries {
        if image_paths.len() >= MAX_OFFICE_EXTRACT_IMAGES {
            break;
        }
        let base = name
            .split('/')
            .next_back()
            .map(sanitize_filename)
            .unwrap_or_else(|| format!("slide_{}.img", image_paths.len() + 1));
        let dest = export_dir.join(&base);
        let mut out = File::create(&dest).map_err(|e| format!("写入幻灯片图片失败: {e}"))?;
        out.write_all(&bytes)
            .map_err(|e| format!("写入幻灯片图片失败: {e}"))?;
        image_paths.push(dest.to_string_lossy().to_string());
    }

    let mut text_preview = text_parts.join("\n\n");
    let image_only = text_preview.trim().is_empty() && !image_paths.is_empty();
    if text_preview.chars().count() > MAX_OFFICE_TEXT_PREVIEW_CHARS {
        text_preview = text_preview
            .chars()
            .take(MAX_OFFICE_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text_preview.push_str("\n…（文本预览已截断）");
    }

    let ocr_preview = if skip_ocr {
        String::new()
    } else {
        build_ocr_preview_block(&image_paths)
    };

    Ok(OfficeExtractResult {
        kind: "pptx".into(),
        slide_count: slide_entries.len().max(image_paths.len()) as u32,
        text_preview,
        image_paths,
        image_only,
        ocr_preview,
    })
}

fn extract_docx_context(path: &Path) -> Result<OfficeExtractResult, String> {
    let file = File::open(path).map_err(|e| format!("无法打开 DOCX: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("不是有效的 DOCX 压缩包: {e}"))?;
    let xml_bytes = extract_zip_entry(&mut archive, "word/document.xml")?;
    let xml = String::from_utf8_lossy(&xml_bytes);
    let mut text_preview = extract_xml_text_tags(&xml, "<w:t", "</w:t>");
    if text_preview.chars().count() > MAX_OFFICE_TEXT_PREVIEW_CHARS {
        text_preview = text_preview
            .chars()
            .take(MAX_OFFICE_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text_preview.push_str("\n…（文本预览已截断）");
    }
    Ok(OfficeExtractResult {
        kind: "docx".into(),
        slide_count: 0,
        text_preview,
        image_paths: Vec::new(),
        image_only: false,
        ocr_preview: String::new(),
    })
}

const MAX_XLSX_SHEETS: usize = 8;
const MAX_XLSX_ROWS: usize = 250;

fn parse_xlsx_shared_strings(xml: &str) -> Vec<String> {
    let mut strings = Vec::new();
    let mut rest = xml;
    while let Some(si_start) = rest.find("<si") {
        let after_si = &rest[si_start..];
        let Some(si_end) = after_si.find("</si>") else {
            break;
        };
        let si_block = &after_si[..si_end];
        let mut text = extract_xml_text_tags(si_block, "<t", "</t>");
        if text.is_empty() {
            text = extract_xml_text_tags(si_block, "<v", "</v>");
        }
        strings.push(text);
        rest = &after_si[si_end + 5..];
    }
    strings
}

fn xlsx_cell_is_shared_string(c_open: &str) -> bool {
    c_open.contains(" t=\"s\"") || c_open.contains(" t='s'")
}

fn xlsx_cell_is_inline_string(c_block: &str) -> bool {
    c_block.contains(" t=\"inlineStr\"") || c_block.contains(" t='inlineStr'")
}

fn extract_xlsx_cell_value(c_block: &str, shared: &[String]) -> String {
    if xlsx_cell_is_inline_string(c_block) {
        return extract_xml_text_tags(c_block, "<t", "</t>");
    }
    let v_text = extract_xml_text_tags(c_block, "<v", "</v>");
    if xlsx_cell_is_shared_string(c_block) {
        if let Ok(idx) = v_text.trim().parse::<usize>() {
            return shared.get(idx).cloned().unwrap_or_default();
        }
    }
    v_text.trim().to_string()
}

fn extract_xlsx_sheet_rows(xml: &str, shared: &[String]) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut rest = xml;
    while rows.len() < MAX_XLSX_ROWS {
        let Some(row_start) = rest.find("<row") else {
            break;
        };
        let after_row = &rest[row_start..];
        let Some(row_end) = after_row.find("</row>") else {
            break;
        };
        let row_block = &after_row[..row_end];
        let mut cells: Vec<String> = Vec::new();
        let mut cell_rest = row_block;
        while let Some(c_start) = cell_rest.find("<c ") {
            let after_c = &cell_rest[c_start..];
            let Some(c_close) = after_c.find("</c>") else {
                break;
            };
            let c_block = &after_c[..c_close + 4];
            let cell = extract_xlsx_cell_value(c_block, shared);
            if !cell.is_empty() {
                cells.push(cell);
            }
            cell_rest = &after_c[c_close + 4..];
        }
        if !cells.is_empty() {
            rows.push(cells);
        }
        rest = &after_row[row_end + 6..];
    }
    rows
}

fn extract_xlsx_context(path: &Path) -> Result<OfficeExtractResult, String> {
    let file = File::open(path).map_err(|e| format!("无法打开 XLSX: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("不是有效的 XLSX 压缩包: {e}"))?;

    let shared = if archive.by_name("xl/sharedStrings.xml").is_ok() {
        let xml_bytes = extract_zip_entry(&mut archive, "xl/sharedStrings.xml")?;
        let xml = String::from_utf8_lossy(&xml_bytes);
        parse_xlsx_shared_strings(&xml)
    } else {
        Vec::new()
    };

    let mut sheet_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let entry = archive.by_index(i).ok()?;
            let name = entry.name().to_string();
            if name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml") {
                Some(name)
            } else {
                None
            }
        })
        .collect();
    sheet_names.sort();

    let mut text_parts: Vec<String> = Vec::new();
    for (idx, sheet_name) in sheet_names.iter().take(MAX_XLSX_SHEETS).enumerate() {
        let xml_bytes = extract_zip_entry(&mut archive, sheet_name)?;
        let xml = String::from_utf8_lossy(&xml_bytes);
        let rows = extract_xlsx_sheet_rows(&xml, &shared);
        if rows.is_empty() {
            continue;
        }
        let mut sheet_text = format!("【工作表{} · {}】", idx + 1, sheet_name);
        for row in rows {
            sheet_text.push('\n');
            sheet_text.push_str(&row.join("\t"));
        }
        text_parts.push(sheet_text);
    }

    if text_parts.is_empty() {
        return Err("未能从 XLSX 中提取到可读单元格内容".into());
    }

    let mut text_preview = text_parts.join("\n\n");
    if text_preview.chars().count() > MAX_OFFICE_TEXT_PREVIEW_CHARS {
        text_preview = text_preview
            .chars()
            .take(MAX_OFFICE_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text_preview.push_str("\n…（表格预览已截断）");
    }

    Ok(OfficeExtractResult {
        kind: "xlsx".into(),
        slide_count: sheet_names.len().min(MAX_XLSX_SHEETS) as u32,
        text_preview,
        image_paths: Vec::new(),
        image_only: false,
        ocr_preview: String::new(),
    })
}

fn extract_xls_context(path: &Path) -> Result<OfficeExtractResult, String> {
    #[cfg(feature = "xls")]
    {
        extract_xls_context_inner(path)
    }
    #[cfg(not(feature = "xls"))]
    {
        let _ = path;
        Err("当前构建未启用 .xls 预提取（需 xls feature）".into())
    }
}

#[cfg(feature = "xls")]
fn extract_xls_context_inner(path: &Path) -> Result<OfficeExtractResult, String> {
    use calamine::{Reader, Xls};
    const MAX_XLS_SHEETS: usize = 8;
    const MAX_XLS_ROWS: usize = 500;
    let file = File::open(path).map_err(|e| format!("无法打开 XLS: {e}"))?;
    let mut workbook = Xls::new(file).map_err(|e| format!("无法解析 XLS: {e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut text_parts: Vec<String> = Vec::new();
    for (idx, name) in sheet_names.iter().take(MAX_XLS_SHEETS).enumerate() {
        let Ok(range) = workbook.worksheet_range(name) else {
            continue;
        };
        let mut rows: Vec<String> = Vec::new();
        for row in range.rows().take(MAX_XLS_ROWS) {
            let cells: Vec<String> = row.iter().map(|c| c.to_string()).collect();
            if cells.iter().any(|c| !c.trim().is_empty()) {
                rows.push(cells.join("\t"));
            }
        }
        if rows.is_empty() {
            continue;
        }
        text_parts.push(format!("【工作表{} · {}】\n{}", idx + 1, name, rows.join("\n")));
    }
    if text_parts.is_empty() {
        return Err("未能从 XLS 中提取到可读单元格内容".into());
    }
    let mut text_preview = text_parts.join("\n\n");
    if text_preview.chars().count() > MAX_OFFICE_TEXT_PREVIEW_CHARS {
        text_preview = text_preview
            .chars()
            .take(MAX_OFFICE_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text_preview.push_str("\n…（表格预览已截断）");
    }
    Ok(OfficeExtractResult {
        kind: "xls".into(),
        slide_count: sheet_names.len().min(MAX_XLS_SHEETS) as u32,
        text_preview,
        image_paths: Vec::new(),
        image_only: false,
        ocr_preview: String::new(),
    })
}

fn extract_pdf_embedded_images(bytes: &[u8], export_dir: &Path) -> Result<Vec<String>, String> {
    use lopdf::{Document, Object};

    let doc = Document::load_mem(bytes).map_err(|e| format!("PDF 解析失败: {e}"))?;
    fs::create_dir_all(export_dir).map_err(|e| format!("创建 PDF 导出目录失败: {e}"))?;

    let mut paths: Vec<String> = Vec::new();

    for obj in doc.objects.values() {
        if paths.len() >= MAX_OFFICE_EXTRACT_IMAGES {
            break;
        }
        let Object::Stream(stream) = obj else {
            continue;
        };
        let subtype = stream
            .dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name().ok());
        if subtype != Some(b"Image") {
            continue;
        }

        let filter = stream.dict.get(b"Filter").ok();
        let filter_name: Vec<u8> = match filter {
            Some(Object::Name(name)) => name.clone(),
            Some(Object::Array(arr)) => arr
                .first()
                .and_then(|o| o.as_name().ok())
                .map(|n| n.to_vec())
                .unwrap_or_default(),
            _ => Vec::new(),
        };

        let data = stream
            .decompressed_content()
            .map_err(|e| format!("PDF 图片流解压失败: {e}"))?;
        if data.is_empty() || data.len() as u64 > MAX_OFFICE_IMAGE_BYTES {
            continue;
        }

        let (ext, bytes): (&str, Vec<u8>) = if filter_name.as_slice() == b"DCTDecode" {
            ("jpg", data)
        } else if filter_name.as_slice() == b"JPXDecode" {
            ("jp2", data)
        } else {
            continue;
        };

        let dest = export_dir.join(format!("page_{:03}.{ext}", paths.len() + 1));
        fs::write(&dest, &bytes).map_err(|e| format!("写入 PDF 页图失败: {e}"))?;
        paths.push(dest.to_string_lossy().to_string());
    }

    if paths.is_empty() {
        return Err(
            "PDF 中未提取到可读文本或内嵌图片（扫描件请尝试导出图片上传，或确认安装包内置 OCR 可用）"
                .into(),
        );
    }

    paths.sort();
    Ok(paths)
}

fn extract_pdf_context(
    path: &Path,
    export_dir: &Path,
    skip_ocr: bool,
) -> Result<OfficeExtractResult, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取 PDF 失败: {e}"))?;
    if meta.len() > MAX_UPLOAD_BYTES {
        return Err("PDF 文件过大（超过 48MB）".into());
    }
    let bytes = fs::read(path).map_err(|e| format!("读取 PDF 失败: {e}"))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("PDF 文本提取失败: {e}"))?;
    let mut text_preview = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text_preview.trim().is_empty() {
        let image_paths = extract_pdf_embedded_images(&bytes, export_dir)?;
        let ocr_preview = if skip_ocr {
            String::new()
        } else {
            build_ocr_preview_block(&image_paths)
        };
        return Ok(OfficeExtractResult {
            kind: "pdf".into(),
            slide_count: image_paths.len().min(999) as u32,
            text_preview: String::new(),
            image_paths,
            image_only: true,
            ocr_preview,
        });
    }
    if text_preview.chars().count() > MAX_OFFICE_TEXT_PREVIEW_CHARS {
        text_preview = text_preview
            .chars()
            .take(MAX_OFFICE_TEXT_PREVIEW_CHARS)
            .collect::<String>();
        text_preview.push_str("\n…（PDF 预览已截断）");
    }
    let page_hint = text_preview.matches('\x0c').count();
    let slide_count = if page_hint > 0 {
        (page_hint + 1).min(999) as u32
    } else {
        0
    };
    Ok(OfficeExtractResult {
        kind: "pdf".into(),
        slide_count,
        text_preview,
        image_paths: Vec::new(),
        image_only: false,
        ocr_preview: String::new(),
    })
}

fn doc_convert_stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
        .to_string()
}

/// 从 `.doc` 派生的合法新文件名；Word COM / LibreOffice 输出统一落到目标路径。
fn converted_target_path(work: &Path, name: &str) -> PathBuf {
    work.join(name)
}

#[cfg(windows)]
fn run_powershell_convert(script_body: &str, src: &Path, out: &Path) -> bool {
    let work = std::env::temp_dir().join(format!("yuntu-ps1-{}", doc_convert_stamp()));
    if fs::create_dir_all(&work).is_err() {
        return false;
    }
    let script = work.join("convert.ps1");
    let ok = fs::write(&script, script_body)
        .map_err(|e| e.to_string())
        .map(|_| {
            let out_str = out.to_string_lossy().to_string();
            let src_str = src.to_string_lossy().to_string();
            let script_str = script.to_string_lossy().to_string();
            let mut cmd = Command::new("powershell");
            cmd.args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                &script_str,
                "-SourcePath",
                &src_str,
                "-TargetPath",
                &out_str,
            ]);
            crate::openclaw_exec::hide_console(&mut cmd);
            let done = crate::openclaw_exec::command_output_timed_full(
                cmd,
                Duration::from_secs(180),
            );
            matches!(done, Some(o) if o.status.success()) && out.is_file()
        })
        .unwrap_or(false);
    let _ = fs::remove_dir_all(&work);
    ok
}

#[cfg(windows)]
fn try_word_com_to_docx(src: &Path, out: &Path) -> bool {
    let script = r#"
param([string]$SourcePath, [string]$TargetPath)
$ErrorActionPreference = 'Stop'
$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($SourcePath, $false, $true)
    $doc.SaveAs2($TargetPath, 16)
    $doc.Close(0)
} finally {
    if ($null -ne $word) { $word.Quit() }
}
"#;
    run_powershell_convert(script, src, out)
}

#[cfg(windows)]
fn try_powerpoint_com_to_pptx(src: &Path, out: &Path) -> bool {
    let script = r#"
param([string]$SourcePath, [string]$TargetPath)
$ErrorActionPreference = 'Stop'
$ppt = $null
try {
    $ppt = New-Object -ComObject PowerPoint.Application
    $pres = $ppt.Presentations.Open($SourcePath, $true, $false, $false)
    $pres.SaveAs($TargetPath, 24)
    $pres.Close()
} finally {
    if ($null -ne $ppt) { $ppt.Quit() }
}
"#;
    run_powershell_convert(script, src, out)
}

fn soffice_user_install_uri(dir: &Path) -> String {
    let s = dir.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

fn probe_soffice(candidate: &Path) -> bool {
    let mut cmd = Command::new(candidate);
    cmd.arg("--headless").arg("--version");
    crate::openclaw_exec::hide_console(&mut cmd);
    matches!(
        crate::openclaw_exec::command_output_timed_full(cmd, Duration::from_secs(12)),
        Some(o) if o.status.success()
    )
}

fn resolve_soffice() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) {
        &["soffice.exe", "soffice.com", "soffice"]
    } else {
        &["soffice", "libreoffice"]
    };
    for name in names {
        if probe_soffice(Path::new(name)) {
            return Some(PathBuf::from(name));
        }
    }
    let paths: &[&str] = if cfg!(windows) {
        &[
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
            r"D:\Program Files\LibreOffice\program\soffice.exe",
        ]
    } else {
        &[
            "/usr/bin/soffice",
            "/usr/bin/libreoffice",
            "/opt/libreoffice/program/soffice",
        ]
    };
    for p in paths {
        let pb = PathBuf::from(p);
        if pb.is_file() && probe_soffice(&pb) {
            return Some(pb);
        }
    }
    None
}

/// 用 LibreOffice 无头转换（`--convert-to`），输出到 work 目录。
fn try_soffice_convert(src: &Path, work: &Path, filter: &str) -> bool {
    let Some(soffice) = resolve_soffice() else {
        return false;
    };
    let profile_uri = soffice_user_install_uri(&work.join("lo-profile"));
    let mut cmd = Command::new(soffice);
    cmd.arg(format!("-env:UserInstallation={profile_uri}"))
        .arg("--headless")
        .arg("--norestore")
        .arg("--convert-to")
        .arg(filter)
        .arg("--outdir")
        .arg(work)
        .arg(src);
    crate::openclaw_exec::hide_console(&mut cmd);
    matches!(
        crate::openclaw_exec::command_output_timed_full(cmd, Duration::from_secs(180)),
        Some(o) if o.status.success()
    )
}

/// 定位转换后的产物（Word COM 输出固定名，LibreOffice 按源文件名输出）。
fn find_converted(work: &Path, fixed: &Path, src: &Path, ext: &str) -> Option<PathBuf> {
    if fixed.is_file() {
        return Some(fixed.to_path_buf());
    }
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let by_stem = work.join(format!("{stem}.{ext}"));
    if by_stem.is_file() {
        return Some(by_stem);
    }
    None
}

/// 旧版 `.doc`：优先本机 Word COM，其次 LibreOffice，成功后按 DOCX 提取正文。
fn extract_doc_context(path: &Path) -> Result<OfficeExtractResult, String> {
    let work = std::env::temp_dir().join(format!("yuntu-doc-{}", doc_convert_stamp()));
    fs::create_dir_all(&work).map_err(|e| format!("创建转换目录失败: {e}"))?;
    let fixed = converted_target_path(&work, "converted.docx");

    #[cfg(windows)]
    let converted = try_word_com_to_docx(path, &fixed) || try_soffice_convert(path, &work, "docx");
    #[cfg(not(windows))]
    let converted = try_soffice_convert(path, &work, "docx");

    let Some(docx) = find_converted(&work, &fixed, path, "docx") else {
        let _ = fs::remove_dir_all(&work);
        return Err(
            "旧版 .doc 无法在本机转换：未检测到 Microsoft Word/Office 或 LibreOffice。请安装 Office 或 LibreOffice，或先在 Word 中「另存为」.docx 后再上传。"
                .into(),
        );
    };
    if !converted {
        let _ = fs::remove_dir_all(&work);
        return Err(
            "旧版 .doc 转换失败（Word/LibreOffice 均不可用）。请在 Word 中「另存为」.docx 后再上传。"
                .into(),
        );
    }
    let mut result = extract_docx_context(&docx)?;
    result.kind = "doc".into();
    let _ = fs::remove_dir_all(&work);
    Ok(result)
}

/// 旧版 `.ppt`：优先本机 PowerPoint COM，其次 LibreOffice，成功后按 PPTX 提取。
fn extract_ppt_context(
    path: &Path,
    export_dir: &Path,
    skip_ocr: bool,
) -> Result<OfficeExtractResult, String> {
    let work = std::env::temp_dir().join(format!("yuntu-ppt-{}", doc_convert_stamp()));
    fs::create_dir_all(&work).map_err(|e| format!("创建转换目录失败: {e}"))?;
    let fixed = converted_target_path(&work, "converted.pptx");

    #[cfg(windows)]
    let converted =
        try_powerpoint_com_to_pptx(path, &fixed) || try_soffice_convert(path, &work, "pptx");
    #[cfg(not(windows))]
    let converted = try_soffice_convert(path, &work, "pptx");

    let Some(pptx) = find_converted(&work, &fixed, path, "pptx") else {
        let _ = fs::remove_dir_all(&work);
        return Err(
            "旧版 .ppt 无法在本机转换：未检测到 Microsoft PowerPoint/Office 或 LibreOffice。请安装 Office 或 LibreOffice，或先在 PowerPoint 中「另存为」.pptx 后再上传。"
                .into(),
        );
    };
    if !converted {
        let _ = fs::remove_dir_all(&work);
        return Err(
            "旧版 .ppt 转换失败（PowerPoint/LibreOffice 均不可用）。请在 PowerPoint 中「另存为」.pptx 后再上传。"
                .into(),
        );
    }
    let mut result = extract_pptx_context(&pptx, export_dir, skip_ocr)?;
    result.kind = "ppt".into();
    let _ = fs::remove_dir_all(&work);
    Ok(result)
}

/// 从 PPTX/DOCX/XLSX/XLS/PDF/DOC/PPT 提取可读文本，并将 PPTX 内嵌图片导出到工作区 inbox。
/// OLE 复合文档魔数（旧版 .doc/.ppt/.xls 二进制文件头）。
fn sniff_ole_signature(path: &Path) -> bool {
    let Ok(mut f) = File::open(path) else {
        return false;
    };
    let mut buf = [0u8; 8];
    if f.read_exact(&mut buf).is_err() {
        return false;
    }
    buf == [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
}

/// PPT/PPTX 幻灯片图片导出目录（workspace/inbox/<batch>/_ppt_slides/<stem>）。
fn export_dir_for_ppt(src: &Path, batch: &str) -> Result<PathBuf, String> {
    let stem = src
        .file_stem()
        .map(|s| sanitize_filename(&s.to_string_lossy()))
        .unwrap_or_else(|| "presentation".to_string());
    Ok(resolve_workspace_dir(&managed_openclaw_data_dir()?)
        .unwrap_or_else(|_| managed_openclaw_data_dir().unwrap_or_default().join("workspace"))
        .join("inbox")
        .join(batch)
        .join("_ppt_slides")
        .join(stem))
}

#[tauri::command]
pub async fn chat_extract_office_context(
    state: State<'_, DbState>,
    token: String,
    path: String,
    batch_id: String,
    skip_ocr: Option<bool>,
) -> Result<OfficeExtractResult, String> {
    assert_authenticated(&state, &token)?;
    let batch = validate_batch_id(&batch_id)?;
    let src = validate_file_path(&path)?;
    let skip_ocr = skip_ocr.unwrap_or(false);
    let lower = src
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    tauri::async_runtime::spawn_blocking(move || {
        let ole_sig = sniff_ole_signature(&src);
        if lower.ends_with(".pptx") {
            let export_dir = export_dir_for_ppt(&src, &batch)?;
            match extract_pptx_context(&src, &export_dir, skip_ocr) {
                Ok(r) => return Ok(r),
                Err(_e) if ole_sig => return extract_ppt_context(&src, &export_dir, skip_ocr),
                Err(e) => return Err(e),
            }
        }
        if lower.ends_with(".docx") {
            match extract_docx_context(&src) {
                Ok(r) => return Ok(r),
                Err(_e) if ole_sig => return extract_doc_context(&src),
                Err(e) => return Err(e),
            }
        }
        if lower.ends_with(".xlsx") {
            return extract_xlsx_context(&src);
        }
        if lower.ends_with(".pdf") {
            let stem = src
                .file_stem()
                .map(|s| sanitize_filename(&s.to_string_lossy()))
                .unwrap_or_else(|| "pdf".to_string());
            let export_dir = resolve_workspace_dir(&managed_openclaw_data_dir()?)
                .unwrap_or_else(|_| managed_openclaw_data_dir().unwrap_or_default().join("workspace"))
                .join("inbox")
                .join(&batch)
                .join("_pdf_pages")
                .join(stem);
            return extract_pdf_context(&src, &export_dir, skip_ocr);
        }
        if lower.ends_with(".xls") {
            return extract_xls_context(&src);
        }
        if lower.ends_with(".doc") {
            return extract_doc_context(&src);
        }
        if lower.ends_with(".ppt") {
            let export_dir = export_dir_for_ppt(&src, &batch)?;
            return extract_ppt_context(&src, &export_dir, skip_ocr);
        }
        Err("仅支持 .pptx / .docx / .xlsx / .xls / .pdf / .doc / .ppt 文档预提取".into())
    })
    .await
    .map_err(|e| format!("文档预提取失败: {e}"))?
}

fn humanize_ocr_error(err: &str) -> String {
    let e = err.trim();
    if e.is_empty() {
        return "未能识别文字".into();
    }
    let lower = e.to_lowercase();
    if lower.contains("tesseract") || lower.contains("tessdata") || lower.contains("chi_sim") {
        return "内置 OCR 引擎或语言包不可用".into();
    }
    if lower.contains("timeout") || e.contains("超时") {
        return "识别超时".into();
    }
    if lower.contains("permission") || lower.contains("access") || lower.contains("denied") {
        return "无权限读取图片".into();
    }
    if lower.contains("not found") || lower.contains("enoent") || e.contains("找不到") {
        return "图片文件不存在".into();
    }
    if e.chars().count() > 80 {
        format!("{}…", e.chars().take(77).collect::<String>())
    } else {
        e.to_string()
    }
}

fn build_ocr_preview_block(image_paths: &[String]) -> String {
    if image_paths.is_empty() {
        return String::new();
    }
    let results = crate::ocr::recognize_image_paths(image_paths);
    let mut blocks: Vec<String> = Vec::new();
    for (idx, item) in results.iter().enumerate() {
        if item.ok && !item.text.trim().is_empty() {
            blocks.push(format!(
                "【OCR 第{}张 · {} · {}】\n{}",
                idx + 1,
                item.name,
                item.engine,
                item.text.trim()
            ));
        } else if let Some(err) = &item.error {
            blocks.push(format!(
                "【OCR 第{}张 · {}】未能识别：{}",
                idx + 1,
                item.name,
                humanize_ocr_error(err)
            ));
        }
    }
    blocks.join("\n\n")
}

/// 对多张图片执行内置 OCR（发附件前优先调用）。
#[tauri::command]
pub async fn chat_ocr_image_paths(
    state: State<'_, DbState>,
    token: String,
    paths: Vec<String>,
) -> Result<Vec<crate::ocr::OcrImageResult>, String> {
    assert_authenticated(&state, &token)?;
    let paths: Vec<String> = paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let validated: Result<Vec<String>, String> = paths
        .into_iter()
        .map(|raw| validate_attachment_ingest_path(&raw).map(|p| p.to_string_lossy().to_string()))
        .collect();
    let paths = validated?;
    tauri::async_runtime::spawn_blocking(move || crate::ocr::recognize_image_paths(&paths))
        .await
        .map_err(|e| format!("OCR 任务失败: {e}"))
}

/// 内置办公写回：将 JSON 数据写入用户 output 目录（csv / xlsx / docx）。
#[tauri::command]
pub async fn chat_write_office_output(
    state: State<'_, DbState>,
    token: String,
    format: String,
    filename: String,
    data_json: String,
) -> Result<ChatSavedFile, String> {
    assert_authenticated(&state, &token)?;
    let fmt = format.trim().to_lowercase();
    let ext = match fmt.as_str() {
        "csv" => ".csv",
        "xlsx" => ".xlsx",
        "docx" => ".docx",
        other => return Err(format!("不支持的格式：{other}（仅 csv / xlsx / docx）")),
    };
    let name = crate::office_write::sanitize_output_filename(&filename, ext);
    let root = resolve_output_dir()?;
    let out_path = crate::office_write::allocate_unique_output_path(&root.join(&name));
    let saved_name = out_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or(name);
    let out_path_str = out_path.to_string_lossy().to_string();
    let json = data_json;
    let fmt_copy = fmt.clone();
    let size = tauri::async_runtime::spawn_blocking(move || {
        crate::office_write::write_office_output(&fmt_copy, &out_path, &json)
    })
    .await
    .map_err(|e| format!("写回任务失败: {e}"))??;
    Ok(ChatSavedFile {
        name: saved_name,
        path: out_path_str,
        size,
    })
}

#[tauri::command]
pub async fn chat_scan_new_output_files(
    state: State<'_, DbState>,
    token: String,
    since_ms: u64,
) -> Result<Vec<ChatSavedFile>, String> {
    assert_authenticated(&state, &token)?;
    let root = resolve_output_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = Vec::new();
        scan_dir_since(&root, since_ms, true, &mut files);
        files.sort_by(|a, b| a.name.cmp(&b.name));
        files
    })
    .await
    .map_err(|e| format!("扫描产出文件失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_xml_text_tags_reads_slide_text() {
        let xml = r#"<p><a:t>标题</a:t><a:t>正文</a:t></p>"#;
        let text = extract_xml_text_tags(xml, "<a:t", "</a:t>");
        assert!(text.contains("标题"));
        assert!(text.contains("正文"));
    }

    #[test]
    fn decode_basic_xml_entities_unescapes() {
        assert_eq!(decode_basic_xml_entities("A &amp; B"), "A & B");
    }

    #[test]
    fn path_has_parent_traversal_detects_dotdot() {
        assert!(path_has_parent_traversal(Path::new("C:\\a\\..\\b")));
        assert!(!path_has_parent_traversal(Path::new("C:\\a\\b")));
    }

    #[test]
    fn is_writable_output_dir_checks_temp() {
        let dir = std::env::temp_dir();
        assert!(is_writable_output_dir(&dir));
    }

    #[test]
    fn merge_dir_into_noops_when_src_equals_dest() {
        let dir = std::env::temp_dir();
        assert!(merge_dir_into(&dir, &dir).is_ok());
    }
}
