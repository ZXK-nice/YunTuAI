//! AI 作图：火山引擎方舟 / 万码云等 OpenAI 兼容 images/generations 接口。

use crate::auth::assert_authenticated;
use crate::chat_files::resolve_output_dir;
use crate::db::DbState;
use crate::openclaw_env::{read_managed_env_map, write_managed_env_values};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

pub const SEEDREAM_API_KEY_ENV: &str = "SEEDREAM_API_KEY";
pub const SEEDREAM_BASE_URL_ENV: &str = "SEEDREAM_BASE_URL";
pub const SEEDREAM_MODEL_ENV: &str = "SEEDREAM_MODEL";
pub const SEEDREAM_SIZE_ENV: &str = "SEEDREAM_SIZE";
pub const SEEDREAM_PROVIDER_ENV: &str = "SEEDREAM_PROVIDER";

const DEFAULT_VOLC_BASE: &str = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_VOLC_MODEL: &str = "doubao-seedream-5-0-pro-260628";
const DEFAULT_WCODE_BASE: &str = "https://wcode.net/api/gpt/v1/images/generations";
const DEFAULT_WCODE_MODEL: &str = "doubao/doubao-seedream-5.0-pro";
const DEFAULT_SIZE: &str = "2K";
const DEFAULT_PROVIDER: &str = "wcode";
const HTTP_TIMEOUT_SECS: u64 = 180;
/// 单张图片最大 32MB，防止异常响应撑爆内存
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
const MAX_REF_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_REFERENCE_IMAGES: usize = 3;
const LIST_HISTORY_CAP: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenConfig {
    pub configured: bool,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub size: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub prompt: String,
    pub model: String,
    pub created_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_paths: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ImageApiResponse {
    #[serde(default)]
    data: Vec<ImageApiDataItem>,
    #[serde(default)]
    error: Option<ImageApiError>,
}

#[derive(Debug, Deserialize)]
struct ImageApiError {
    message: Option<String>,
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ImageApiDataItem {
    url: Option<String>,
    b64_json: Option<String>,
    #[serde(default)]
    size: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ImageMetaSidecar {
    prompt: String,
    model: String,
    size: String,
    created_at_ms: i64,
    #[serde(default)]
    mode: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    reference_paths: Vec<String>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn provider_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider.trim().to_lowercase().as_str() {
        "wcode" | "wanma" | "万码" => (DEFAULT_WCODE_BASE, DEFAULT_WCODE_MODEL),
        _ => (DEFAULT_VOLC_BASE, DEFAULT_VOLC_MODEL),
    }
}

fn is_wcode_provider(provider: &str, base_url: &str) -> bool {
    provider.trim().eq_ignore_ascii_case("wcode")
        || provider.contains("万码")
        || base_url.contains("wcode.net")
}

fn validate_size(size: &str) -> Result<String, String> {
    let s = size.trim();
    if s.is_empty() {
        return Ok(DEFAULT_SIZE.to_string());
    }
    let upper = s.to_uppercase();
    if upper == "1K" || upper == "2K" || upper == "3K" || upper == "4K" {
        return Ok(upper);
    }
    if let Some((w, h)) = s.split_once('x').or_else(|| s.split_once('X')) {
        let w: u32 = w.trim().parse().map_err(|_| "尺寸宽度无效".to_string())?;
        let h: u32 = h.trim().parse().map_err(|_| "尺寸高度无效".to_string())?;
        if w < 512 || h < 512 || w > 4096 || h > 4096 {
            return Err("自定义尺寸须在 512～4096 像素之间".into());
        }
        return Ok(format!("{w}x{h}"));
    }
    Err("尺寸仅支持 1K、2K、3K、4K 或 WIDTHxHEIGHT".into())
}

fn sanitize_image_ext(ext: &str) -> &str {
    match ext.trim().trim_start_matches('.').to_lowercase().as_str() {
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        _ => "png",
    }
}

fn file_mtime_ms(path: &Path) -> i64 {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn humanize_api_error(status: u16, body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = v
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .or_else(|| v.get("message").and_then(|m| m.as_str()))
        {
            if status == 401 || status == 403 {
                return format!(
                    "API Key 无效或未授权（HTTP {status}）：{msg}。请确认服务商与 Key 来源一致。"
                );
            }
            return format!("HTTP {status}: {msg}");
        }
    }
    if status == 401 || status == 403 {
        return format!(
            "API Key 无效或未授权（HTTP {status}）。请检查服务商选择是否正确，并确认已开通 Seedream 5.0 模型。"
        );
    }
    format!("HTTP {status}: {}", body.chars().take(240).collect::<String>())
}

fn mask_api_key(key: &str) -> String {
    let t = key.trim();
    if t.len() <= 8 {
        return "****".into();
    }
    format!("{}…{}", &t[..4], &t[t.len() - 4..])
}

fn load_config_from_env() -> Result<ImageGenConfig, String> {
    let map = read_managed_env_map()?;
    let api_key = map
        .get(SEEDREAM_API_KEY_ENV)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let provider = map
        .get(SEEDREAM_PROVIDER_ENV)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_PROVIDER.into());
    let (def_base, def_model) = provider_defaults(&provider);
    let base_url = map
        .get(SEEDREAM_BASE_URL_ENV)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| def_base.to_string());
    let model = map
        .get(SEEDREAM_MODEL_ENV)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| def_model.to_string());
    let size = map
        .get(SEEDREAM_SIZE_ENV)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_SIZE.into());
    Ok(ImageGenConfig {
        configured: api_key.is_some(),
        provider,
        base_url,
        model,
        size,
        api_key_hint: api_key.map(mask_api_key),
    })
}

fn require_api_key() -> Result<String, String> {
    let map = read_managed_env_map()?;
    map.get(SEEDREAM_API_KEY_ENV)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "请先在 AI 作图页配置 Seedream API Key".into())
}

fn image_studio_dir() -> Result<PathBuf, String> {
    let p = resolve_output_dir()?.join("image-studio");
    fs::create_dir_all(&p).map_err(|e| format!("创建作图目录失败: {e}"))?;
    Ok(p)
}

fn parse_image_size_hint(size: &str) -> (Option<u32>, Option<u32>) {
    let s = size.trim().to_uppercase();
    if s == "1K" {
        return (Some(1024), Some(1024));
    }
    if s == "2K" {
        return (Some(1664), Some(2496));
    }
    if s == "3K" {
        return (Some(3072), Some(3072));
    }
    if s == "4K" {
        return (Some(4096), Some(4096));
    }
    if let Some((w, h)) = size.split_once('x').or_else(|| size.split_once('X')) {
        let w = w.trim().parse().ok();
        let h = h.trim().parse().ok();
        return (w, h);
    }
    (None, None)
}

fn volc_model_supports_sequential(model: &str) -> bool {
    let m = model.trim().to_lowercase();
    // Seedream 5.0 Pro 官方文档：不支持 sequential_image_generation 参数
    !(m.contains("5-0-pro") || m.contains("5.0-pro"))
}

fn build_volc_request_body(model: &str, prompt: &str, size: &str, image: Option<&Value>) -> Value {
    let mut body = json!({
        "model": model,
        "prompt": prompt,
        "response_format": "url",
        "size": size,
        "stream": false,
        "watermark": false
    });
    if volc_model_supports_sequential(model) {
        body["sequential_image_generation"] = json!("disabled");
    }
    if let Some(img) = image {
        body["image"] = img.clone();
    }
    body
}

fn build_request_body(
    config: &ImageGenConfig,
    prompt: &str,
    size: &str,
    image: Option<&Value>,
) -> Value {
    if is_wcode_provider(&config.provider, &config.base_url) {
        let mut body = json!({
            "model": config.model,
            "prompt": prompt,
            "size": size,
            "response_format": "url",
        });
        if let Some(img) = image {
            body["image"] = img.clone();
        }
        return body;
    }
    build_volc_request_body(&config.model, prompt, size, image)
}

fn build_probe_body(config: &ImageGenConfig) -> Value {
    if is_wcode_provider(&config.provider, &config.base_url) {
        return json!({
            "model": config.model,
            "prompt": "connection probe",
            "size": "1K",
            "response_format": "url",
        });
    }
    build_volc_request_body(&config.model, "connection probe", "1K", None)
}

fn parse_api_response(raw: &str) -> Result<Vec<ImageApiDataItem>, String> {
    let parsed: ImageApiResponse =
        serde_json::from_str(raw).map_err(|e| format!("解析生图响应失败: {e}"))?;
    if let Some(err) = parsed.error {
        let msg = err.message.unwrap_or_else(|| "未知错误".into());
        let code = err.code.unwrap_or_default();
        if code.is_empty() {
            return Err(msg);
        }
        return Err(format!("{code}: {msg}"));
    }
    if parsed.data.is_empty() {
        return Err("生图接口未返回图片数据".into());
    }
    Ok(parsed.data)
}

fn http_post_json(url: &str, api_key: &str, body: &Value) -> Result<String, String> {
    let body_str = serde_json::to_string(body).map_err(|e| format!("序列化请求失败: {e}"))?;
    let resp = ureq::post(url)
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .set("Authorization", &format!("Bearer {api_key}"))
        .set("Content-Type", "application/json")
        .send_string(&body_str)
        .map_err(|e| format!("生图请求失败: {e}"))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| format!("读取响应失败: {e}"))?;
    if !(200..300).contains(&status) {
        return Err(humanize_api_error(status, &text));
    }
    Ok(text)
}

fn validate_https_url(url: &str, label: &str) -> Result<(), String> {
    let t = url.trim();
    if !t.starts_with("https://") {
        return Err(format!("{label}须以 https:// 开头"));
    }
    if t.contains("..") {
        return Err(format!("{label}格式无效"));
    }
    Ok(())
}

fn read_limited_bytes<R: Read>(mut reader: R, max: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取图片数据失败: {e}"))?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > max {
            return Err(format!("图片过大（超过 {} MB）", max / 1024 / 1024));
        }
        bytes.extend_from_slice(&buf[..n]);
    }
    Ok(bytes)
}

fn http_get_bytes(url: &str) -> Result<Vec<u8>, String> {
    validate_https_url(url, "图片下载地址")?;
    let resp = ureq::get(url)
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .call()
        .map_err(|e| format!("下载图片失败: {e}"))?;
    let status = resp.status();
    if !(200..300).contains(&status) {
        return Err(format!("下载图片 HTTP {status}"));
    }
    read_limited_bytes(resp.into_reader(), MAX_IMAGE_BYTES)
}

fn save_generated_image(
    prompt: &str,
    model: &str,
    size: &str,
    bytes: &[u8],
    ext: &str,
    mode: &str,
    reference_paths: &[String],
) -> Result<GeneratedImageItem, String> {
    let dir = image_studio_dir()?;
    let id = uuid::Uuid::new_v4().to_string();
    let name = format!("seedream-{id}.{ext}");
    let path = dir.join(&name);
    fs::write(&path, bytes).map_err(|e| format!("保存图片失败: {e}"))?;
    let meta = ImageMetaSidecar {
        prompt: prompt.to_string(),
        model: model.to_string(),
        size: size.to_string(),
        created_at_ms: now_ms(),
        mode: mode.to_string(),
        reference_paths: reference_paths.to_vec(),
    };
    let meta_path = dir.join(format!("{name}.meta.json"));
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入元数据失败: {e}"))?;
    let file_size = bytes.len() as u64;
    let (width, height) = parse_image_size_hint(size);
    let reference_count = if reference_paths.is_empty() {
        None
    } else {
        Some(reference_paths.len() as u32)
    };
    let stored_refs = if reference_paths.is_empty() {
        None
    } else {
        Some(reference_paths.to_vec())
    };
    Ok(GeneratedImageItem {
        id,
        name,
        path: path.to_string_lossy().to_string(),
        size: file_size,
        prompt: prompt.to_string(),
        model: model.to_string(),
        created_at_ms: meta.created_at_ms,
        width,
        height,
        mode: Some(mode.to_string()),
        reference_count,
        reference_paths: stored_refs,
    })
}

fn mime_for_image_path(path: &Path) -> Result<&'static str, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "webp" => Ok("image/webp"),
        "bmp" => Ok("image/bmp"),
        "gif" => Ok("image/gif"),
        _ => Err(format!("不支持的参考图格式: {ext}")),
    }
}

fn reference_inbox_dir() -> Result<PathBuf, String> {
    let p = image_studio_dir()?.join("refs");
    fs::create_dir_all(&p).map_err(|e| format!("创建参考图目录失败: {e}"))?;
    Ok(p)
}

fn path_is_inside(path: &Path, root: &Path) -> bool {
    let Ok(file) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    file.starts_with(root)
}

fn reference_path_key(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('/', "\\")
        .to_lowercase()
}

fn reference_path_recorded_in_studio(path: &Path) -> bool {
    let Ok(studio) = image_studio_dir() else {
        return false;
    };
    let needle = reference_path_key(path);
    let Ok(entries) = fs::read_dir(&studio) else {
        return false;
    };
    for entry in entries.flatten() {
        let meta_path = entry.path();
        let name = meta_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.ends_with(".meta.json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&meta_path) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<ImageMetaSidecar>(&text) else {
            continue;
        };
        if meta
            .reference_paths
            .iter()
            .any(|stored| reference_path_key(Path::new(stored)) == needle)
        {
            return true;
        }
    }
    false
}

fn ensure_reference_path_allowed(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("参考图不存在: {}", path.display()));
    }
    mime_for_image_path(path)?;
    let studio = image_studio_dir()?;
    if path_is_inside(path, &studio) || reference_path_recorded_in_studio(path) {
        return Ok(());
    }
    Err("参考图只能使用作图目录内的文件，或本机已保存过的参考图".into())
}

fn encode_reference_image(path: &str) -> Result<String, String> {
    let p = PathBuf::from(path.trim());
    ensure_reference_path_allowed(&p)?;
    let mime = mime_for_image_path(&p)?;
    let bytes = fs::read(&p).map_err(|e| format!("读取参考图失败: {e}"))?;
    if bytes.is_empty() {
        return Err("参考图为空文件".into());
    }
    if bytes.len() > MAX_REF_IMAGE_BYTES {
        return Err("参考图超过 10MB".into());
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

fn normalize_reference_paths(paths: Option<&[String]>) -> Vec<String> {
    paths
        .unwrap_or(&[])
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn prepare_reference_images(paths: &[String]) -> Result<Option<Value>, String> {
    if paths.is_empty() {
        return Ok(None);
    }
    if paths.len() > MAX_REFERENCE_IMAGES {
        return Err(format!("最多上传 {MAX_REFERENCE_IMAGES} 张参考图"));
    }
    let encoded: Vec<String> = paths
        .iter()
        .map(|p| encode_reference_image(p))
        .collect::<Result<_, _>>()?;
    if encoded.len() == 1 {
        return Ok(Some(json!(encoded[0])));
    }
    Ok(Some(json!(encoded)))
}

fn decode_image_item(
    item: &ImageApiDataItem,
    prompt: &str,
    model: &str,
    size: &str,
    mode: &str,
    reference_paths: &[String],
) -> Result<GeneratedImageItem, String> {
    if let Some(b64) = item.b64_json.as_ref().filter(|s| !s.is_empty()) {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("解码 base64 图片失败: {e}"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "图片过大（超过 {} MB）",
                MAX_IMAGE_BYTES / 1024 / 1024
            ));
        }
        return save_generated_image(prompt, model, size, &bytes, "png", mode, reference_paths);
    }
    if let Some(url) = item.url.as_ref().filter(|s| !s.is_empty()) {
        let bytes = http_get_bytes(url)?;
        let ext = url
            .split('?')
            .next()
            .and_then(|base| Path::new(base).extension())
            .and_then(|e| e.to_str())
            .map(sanitize_image_ext)
            .unwrap_or("png");
        let mut size_hint = size.to_string();
        if let Some(s) = item.size.as_ref().filter(|x| !x.is_empty()) {
            size_hint = s.clone();
        }
        return save_generated_image(
            prompt,
            model,
            &size_hint,
            &bytes,
            ext,
            mode,
            reference_paths,
        );
    }
    Err("生图结果缺少 url 或 b64_json".into())
}

pub fn generate_image(
    prompt: &str,
    size_override: Option<&str>,
    reference_paths: Option<&[String]>,
) -> Result<GeneratedImageItem, String> {
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("提示词不能为空".into());
    }
    if prompt.len() > 4000 {
        return Err("提示词过长（最多 4000 字）".into());
    }
    let refs = normalize_reference_paths(reference_paths);
    if refs.len() > MAX_REFERENCE_IMAGES {
        return Err(format!("最多上传 {MAX_REFERENCE_IMAGES} 张参考图"));
    }
    let mode = if refs.is_empty() { "text" } else { "image" };
    let api_key = require_api_key()?;
    let config = load_config_from_env()?;
    let size = validate_size(
        size_override
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(config.size.as_str()),
    )?;
    let image_value = prepare_reference_images(&refs)?;
    let body = build_request_body(&config, prompt, &size, image_value.as_ref());
    let raw = http_post_json(&config.base_url, &api_key, &body)?;
    let items = parse_api_response(&raw)?;
    decode_image_item(&items[0], prompt, &config.model, &size, mode, &refs)
}

/// 探测 API Key 与端点是否可用（会发起一次真实生图请求，可能产生费用）。
pub fn test_image_gen_connection() -> Result<String, String> {
    let api_key = require_api_key()?;
    let config = load_config_from_env()?;
    let body = build_probe_body(&config);
    let raw = http_post_json(&config.base_url, &api_key, &body)?;
    if parse_api_response(&raw).is_ok() {
        return Ok(format!(
            "连接成功：{} / {}",
            provider_label(&config.provider),
            config.model
        ));
    }
    Ok(format!(
        "端点可达：{} / {}（响应已返回，请尝试正式生图）",
        provider_label(&config.provider),
        config.model
    ))
}

fn provider_label(provider: &str) -> &str {
    if is_wcode_provider(provider, "") {
        "万码云"
    } else {
        "火山引擎方舟"
    }
}

pub fn list_generated_images() -> Result<Vec<GeneratedImageItem>, String> {
    let dir = image_studio_dir()?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if !name.starts_with("seedream-") || name.ends_with(".meta.json") {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "png" && ext != "jpg" && ext != "jpeg" && ext != "webp" {
            continue;
        }
        let meta_path = dir.join(format!("{name}.meta.json"));
        let (prompt, model, created_at_ms, size_hint, mode, reference_count, reference_paths) =
            if meta_path.is_file() {
            let raw = fs::read_to_string(&meta_path).unwrap_or_default();
            if let Ok(meta) = serde_json::from_str::<ImageMetaSidecar>(&raw) {
                let existing_refs: Vec<String> = meta
                    .reference_paths
                    .into_iter()
                    .filter(|p| Path::new(p).is_file())
                    .collect();
                let reference_count = if existing_refs.is_empty() {
                    None
                } else {
                    Some(existing_refs.len() as u32)
                };
                let reference_paths = if existing_refs.is_empty() {
                    None
                } else {
                    Some(existing_refs)
                };
                let mode = if meta.mode.is_empty() {
                    if reference_count.is_some() {
                        "image".to_string()
                    } else {
                        "text".to_string()
                    }
                } else {
                    meta.mode
                };
                (
                    meta.prompt,
                    meta.model,
                    meta.created_at_ms,
                    meta.size,
                    Some(mode),
                    reference_count,
                    reference_paths,
                )
            } else {
                let mtime = file_mtime_ms(&path);
                (
                    String::new(),
                    String::new(),
                    mtime,
                    DEFAULT_SIZE.into(),
                    None,
                    None,
                    None,
                )
            }
        } else {
            let mtime = file_mtime_ms(&path);
            (
                String::new(),
                String::new(),
                mtime,
                DEFAULT_SIZE.into(),
                None,
                None,
                None,
            )
        };
        let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
        let id = name
            .strip_prefix("seedream-")
            .and_then(|s| s.rsplit_once('.'))
            .map(|(id, _)| id.to_string())
            .unwrap_or_else(|| name.clone());
        let (width, height) = parse_image_size_hint(&size_hint);
        out.push(GeneratedImageItem {
            id,
            name,
            path: path.to_string_lossy().to_string(),
            size: file_size,
            prompt,
            model,
            created_at_ms,
            width,
            height,
            mode,
            reference_count,
            reference_paths,
        });
    }
    out.sort_by_key(|item| std::cmp::Reverse(item.created_at_ms));
    out.truncate(LIST_HISTORY_CAP);
    Ok(out)
}

fn is_valid_image_id(id: &str) -> bool {
    !id.is_empty()
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn file_id_from_seedream_name(name: &str) -> Option<&str> {
    let rest = name.strip_prefix("seedream-")?;
    if name.ends_with(".meta.json") {
        return None;
    }
    rest.split('.').next().filter(|id| !id.is_empty())
}

pub fn delete_generated_image(id: &str) -> Result<(), String> {
    let id = id.trim();
    if !is_valid_image_id(id) {
        return Err("无效的图片 ID".into());
    }
    let dir = image_studio_dir()?;
    let mut removed = false;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if file_id_from_seedream_name(&name) == Some(id) {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
            removed = true;
        }
    }
    if removed {
        Ok(())
    } else {
        Err("未找到要删除的图片".into())
    }
}

fn ensure_image_studio_file(path: &Path) -> Result<(), String> {
    let dir = image_studio_dir()?;
    if !path.is_file() {
        return Err("图片文件不存在".into());
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if !file_name.starts_with("seedream-") {
        return Err("无效的图片路径".into());
    }
    let parent = path.parent().ok_or_else(|| "无效的图片路径".to_string())?;
    if parent != dir {
        return Err("只能导出作图目录内的图片".into());
    }
    Ok(())
}

/// 通过系统「另存为」对话框将图片复制到用户选择的位置。
pub fn export_generated_image(source_path: &str) -> Result<Option<String>, String> {
    let src = PathBuf::from(source_path.trim());
    ensure_image_studio_file(&src)?;
    let default_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("seedream-image.png")
        .to_string();
    let Some(dest) = rfd::FileDialog::new().set_file_name(&default_name).save_file() else {
        return Ok(None);
    };
    fs::copy(&src, &dest).map_err(|e| format!("保存图片失败: {e}"))?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

pub fn pick_reference_images() -> Result<Vec<String>, String> {
    let picked = rfd::FileDialog::new()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "bmp", "gif"])
        .pick_files()
        .unwrap_or_default();
    let dir = reference_inbox_dir()?;
    let mut stored = Vec::new();
    for src in picked {
        if !src.is_file() {
            continue;
        }
        let mime_ext = src
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_lowercase();
        mime_for_image_path(&src)?;
        let dest = dir.join(format!("ref-{}.{}", uuid::Uuid::new_v4(), mime_ext));
        fs::copy(&src, &dest).map_err(|e| format!("复制参考图失败: {e}"))?;
        stored.push(dest.to_string_lossy().to_string());
    }
    Ok(stored)
}

pub fn save_image_gen_config(
    api_key: Option<&str>,
    provider: &str,
    base_url: Option<&str>,
    model: Option<&str>,
    size: Option<&str>,
) -> Result<ImageGenConfig, String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return Err("请选择服务商".into());
    }
    let (def_base, def_model) = provider_defaults(provider);
    let resolved_base = base_url
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(def_base)
        .to_string();
    validate_https_url(&resolved_base, "接口地址")?;
    let mut updates = HashMap::new();
    updates.insert(SEEDREAM_PROVIDER_ENV.into(), provider.to_string());
    updates.insert(SEEDREAM_BASE_URL_ENV.into(), resolved_base);
    updates.insert(
        SEEDREAM_MODEL_ENV.into(),
        model
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(def_model)
            .to_string(),
    );
    updates.insert(
        SEEDREAM_SIZE_ENV.into(),
        validate_size(
            size
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(DEFAULT_SIZE),
        )?,
    );
    if let Some(key) = api_key.map(str::trim).filter(|s| !s.is_empty()) {
        if key.len() > 512 {
            return Err("API Key 过长".into());
        }
        updates.insert(SEEDREAM_API_KEY_ENV.into(), key.to_string());
    } else if !load_config_from_env()?.configured {
        return Err("请填写 API Key".into());
    }
    write_managed_env_values(&updates)?;
    load_config_from_env()
}

/// 将对话用 API Key 复制到作图配置（万码云/同 Key 场景）。
#[tauri::command]
pub fn image_gen_use_chat_api_key_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<ImageGenConfig, String> {
    assert_authenticated(&state, &token)?;
    let map = read_managed_env_map()?;
    let chat_key = map
        .get("DEEPSEEK_API_KEY")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            map.get("MIMO_API_KEY")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(String::from)
        })
        .or_else(|| {
            map.get("DASHSCOPE_API_KEY")
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(String::from)
        })
        .or_else(|| {
            map
                .get(crate::distribution_policy::active_distribution_profile().primary_api_env_key())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(String::from)
        })
        .or_else(|| crate::distribution_policy::embedded_relay_api_key().map(|s| s.to_string()));
    let Some(chat_key) = chat_key.filter(|s| !s.is_empty()) else {
        return Err(
            "请先在「API 接入」中配置 MiMo / DeepSeek / 千问 API Key，或单独配置 Seedream Key"
                .to_string(),
        );
    };
    let provider = map
        .get(SEEDREAM_PROVIDER_ENV)
        .map(|s| s.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_PROVIDER);
    save_image_gen_config(Some(&chat_key), provider, None, None, None)
}

#[tauri::command]
pub async fn image_gen_test_connection_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    crate::ipc::run_blocking(test_image_gen_connection).await
}

#[tauri::command]
pub fn image_gen_config_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<ImageGenConfig, String> {
    assert_authenticated(&state, &token)?;
    load_config_from_env()
}

#[tauri::command]
pub fn image_gen_save_config_cmd(
    state: State<'_, DbState>,
    token: String,
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    size: Option<String>,
) -> Result<ImageGenConfig, String> {
    assert_authenticated(&state, &token)?;
    save_image_gen_config(
        api_key.as_deref(),
        &provider,
        base_url.as_deref(),
        model.as_deref(),
        size.as_deref(),
    )
}

#[tauri::command]
pub async fn image_gen_create_cmd(
    state: State<'_, DbState>,
    token: String,
    prompt: String,
    size: Option<String>,
    reference_paths: Option<Vec<String>>,
) -> Result<GeneratedImageItem, String> {
    assert_authenticated(&state, &token)?;
    let size_owned = size;
    crate::ipc::run_blocking(move || {
        generate_image(&prompt, size_owned.as_deref(), reference_paths.as_deref())
    })
    .await
}

#[tauri::command]
pub fn image_gen_pick_references_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<String>, String> {
    assert_authenticated(&state, &token)?;
    pick_reference_images()
}

#[tauri::command]
pub fn image_gen_list_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<Vec<GeneratedImageItem>, String> {
    assert_authenticated(&state, &token)?;
    list_generated_images()
}

#[tauri::command]
pub fn image_gen_delete_cmd(
    state: State<'_, DbState>,
    token: String,
    id: String,
) -> Result<(), String> {
    assert_authenticated(&state, &token)?;
    delete_generated_image(&id)
}

#[tauri::command]
pub fn image_gen_export_cmd(
    state: State<'_, DbState>,
    token: String,
    path: String,
) -> Result<Option<String>, String> {
    assert_authenticated(&state, &token)?;
    export_generated_image(&path)
}

#[tauri::command]
pub fn image_gen_reveal_folder_cmd(
    state: State<'_, DbState>,
    token: String,
) -> Result<String, String> {
    assert_authenticated(&state, &token)?;
    let dir = image_studio_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_response() {
        let raw = r#"{"data":[{"url":"https://example.com/a.png","size":"1664x2496"}]}"#;
        let items = parse_api_response(raw).expect("parse");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url.as_deref(), Some("https://example.com/a.png"));
    }

    #[test]
    fn parse_error_response() {
        let raw = r#"{"error":{"code":"AuthenticationError","message":"bad key"}}"#;
        let err = parse_api_response(raw).unwrap_err();
        assert!(err.contains("AuthenticationError"));
    }

    #[test]
    fn provider_defaults_volc_and_wcode() {
        let (b, m) = provider_defaults("volcengine");
        assert!(b.contains("volces.com"));
        assert!(m.contains("doubao-seedream"));
        let (b2, m2) = provider_defaults("wcode");
        assert!(b2.contains("wcode.net"));
        assert!(m2.contains("doubao/"));
    }

    #[test]
    fn validate_size_accepts_common_values() {
        assert_eq!(validate_size("1K").unwrap(), "1K");
        assert_eq!(validate_size("2k").unwrap(), "2K");
        assert_eq!(validate_size("1024x1024").unwrap(), "1024x1024");
        assert!(validate_size("bad").is_err());
    }

    #[test]
    fn volc_model_supports_sequential_flag() {
        assert!(!volc_model_supports_sequential("doubao-seedream-5-0-pro-260628"));
        assert!(volc_model_supports_sequential("doubao-seedream-4-0-250828"));
    }

    #[test]
    fn wcode_provider_detection() {
        assert!(is_wcode_provider("wcode", ""));
        assert!(is_wcode_provider("volcengine", "https://wcode.net/api"));
        assert!(!is_wcode_provider("volcengine", DEFAULT_VOLC_BASE));
    }

    #[test]
    fn image_id_validation_and_name_parse() {
        assert!(is_valid_image_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890"));
        assert!(!is_valid_image_id("../etc"));
        assert!(!is_valid_image_id(""));
        assert_eq!(
            file_id_from_seedream_name("seedream-abc-123.png"),
            Some("abc-123")
        );
        assert_eq!(file_id_from_seedream_name("seedream-abc-123.png.meta.json"), None);
    }

    #[test]
    fn https_url_validation() {
        assert!(validate_https_url("https://wcode.net/api", "接口").is_ok());
        assert!(validate_https_url("http://evil.com", "接口").is_err());
    }
}
