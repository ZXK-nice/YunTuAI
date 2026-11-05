//! 内置 OCR：发版包优先 bundled Tesseract（tessdata_best + 预处理 + PSM 重试），
//! 并与 Windows.Media.Ocr（`bundled/support/yuntu-ocr.ps1`）择优融合。

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageBuffer, Luma};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_OCR_IMAGE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_OCR_OUTPUT_CHARS: usize = 12_000;
const MAX_OCR_IMAGES_PER_BATCH: usize = 16;
const OCR_UPSCALE_MIN_DIM: u32 = 900;
const OCR_SMALL_IMAGE_DIM: u32 = 450;
/// Tesseract PSM：6=整块文本，3=全自动，11=稀疏文本。
const TESSERACT_PSM_MODES: &[&str] = &["6", "3", "11"];
const OCR_PARALLEL_THREADS: usize = 2;
const OCR_EARLY_EXIT_SCORE: usize = 24;
const OCR_IMAGE_BUDGET: Duration = Duration::from_secs(45);
const OCR_ATTEMPT_MIN: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrImageResult {
    pub path: String,
    pub name: String,
    pub text: String,
    pub engine: String,
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct OcrCandidate {
    text: String,
    engine: &'static str,
    score: usize,
}

fn is_image_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp")
        || lower.ends_with(".webp")
}

fn is_cjk(ch: char) -> bool {
    matches!(
        ch,
        '\u{4E00}'..='\u{9FFF}'
            | '\u{3400}'..='\u{4DBF}'
            | '\u{F900}'..='\u{FAFF}'
            | '\u{3000}'..='\u{303F}'
            | '\u{FF00}'..='\u{FFEF}'
    )
}

fn ocr_text_score(text: &str) -> usize {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let meaningful = trimmed
        .chars()
        .filter(|c| c.is_alphanumeric() || is_cjk(*c))
        .count();
    let total = trimmed.chars().filter(|c| !c.is_whitespace()).count();
    if total == 0 {
        return 0;
    }
    let ratio_bonus = if meaningful * 100 / total >= 55 { 20 } else { 0 };
    meaningful + ratio_bonus
}

fn is_low_quality_ocr(text: &str) -> bool {
    ocr_text_score(text) < 4
}

fn truncate_ocr_text(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() <= MAX_OCR_OUTPUT_CHARS {
        return t.to_string();
    }
    let mut out: String = t.chars().take(MAX_OCR_OUTPUT_CHARS).collect();
    out.push_str("\n…（OCR 文本已截断）");
    out
}

fn enhance_contrast(gray: &ImageBuffer<Luma<u8>, Vec<u8>>) -> ImageBuffer<Luma<u8>, Vec<u8>> {
    let mut hist = [0u32; 256];
    let mut total = 0usize;
    for p in gray.pixels() {
        hist[p[0] as usize] += 1;
        total += 1;
    }
    if total == 0 {
        return gray.clone();
    }
    let lo_target = total * 2 / 100;
    let hi_target = total * 98 / 100;
    let mut lo = 0u8;
    let mut hi = 255u8;
    let mut cum = 0u32;
    for (i, count) in hist.iter().enumerate() {
        cum += *count;
        if cum as usize >= lo_target {
            lo = i as u8;
            break;
        }
    }
    cum = 0;
    for (i, count) in hist.iter().enumerate() {
        cum += *count;
        if cum as usize >= hi_target {
            hi = i as u8;
            break;
        }
    }
    if hi <= lo {
        return gray.clone();
    }
    let span = (hi - lo) as f32;
    let mut out = gray.clone();
    for p in out.pixels_mut() {
        let scaled = ((p[0].saturating_sub(lo) as f32 / span) * 255.0).round() as u8;
        p[0] = scaled;
    }
    out
}

fn preprocess_for_ocr(path: &Path) -> Result<PathBuf, String> {
    let img =
        image::open(path).map_err(|e| format!("读取图片失败: {}", e))?;
    let (w, h) = img.dimensions();
    let min_dim = w.min(h);
    let mut work: DynamicImage = img;
    if min_dim < OCR_UPSCALE_MIN_DIM {
        let scale = if min_dim < OCR_SMALL_IMAGE_DIM { 3.0 } else { 2.0 };
        let nw = ((w as f32) * scale).round().max(1.0) as u32;
        let nh = ((h as f32) * scale).round().max(1.0) as u32;
        work = work.resize(nw, nh, FilterType::Lanczos3);
    }
    let gray = work.to_luma8();
    let enhanced = enhance_contrast(&gray);
    let out_dir = std::env::temp_dir().join("yuntu-ocr");
    fs::create_dir_all(&out_dir).map_err(|e| format!("创建 OCR 临时目录失败: {e}"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out_path = out_dir.join(format!("pre_{stamp}.png"));
    enhanced
        .save(&out_path)
        .map_err(|e| format!("写入 OCR 预处理图失败: {e}"))?;
    Ok(out_path)
}

fn bundled_support_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bundled")
        .join("support")
}

fn bundled_tesseract_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("bundled")
        .join("tesseract")
}

fn installed_tesseract_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [
        dir.join("bundled").join("tesseract"),
        dir.join("tesseract"),
        dir.join("resources").join("tesseract"),
        dir.join("_up_").join("bundled").join("tesseract"),
    ]
    .into_iter()
    .find(|candidate| candidate.join("tesseract.exe").is_file())
}

fn resolve_tesseract() -> Option<(PathBuf, PathBuf)> {
    for root in [installed_tesseract_dir(), Some(bundled_tesseract_dir())] {
        let Some(dir) = root else { continue };
        let exe = dir.join("tesseract.exe");
        let tessdata = dir.join("tessdata");
        if exe.is_file() && tessdata.is_dir() {
            return Some((exe, tessdata));
        }
    }
    None
}

fn ocr_attempt_timeout(started: Instant) -> Option<Duration> {
    OCR_IMAGE_BUDGET
        .checked_sub(started.elapsed())
        .filter(|left| *left >= OCR_ATTEMPT_MIN)
}

fn run_tesseract_with_psm(
    path: &Path,
    exe: &Path,
    tessdata: &Path,
    psm: &str,
    timeout: Duration,
) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.arg(path)
        .arg("stdout")
        .arg("-l")
        .arg("chi_sim+eng")
        .arg("--oem")
        .arg("1")
        .arg("--psm")
        .arg(psm)
        .arg("-c")
        .arg("preserve_interword_spaces=1")
        .arg("--tessdata-dir")
        .arg(tessdata);
    crate::openclaw_exec::hide_console(&mut cmd);
    let Some(out) = crate::openclaw_exec::command_output_timed(cmd, timeout) else {
        return Err(format!("Tesseract 识别超时（{}s）", timeout.as_secs()));
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Tesseract 识别失败: {}", err.trim()));
    }
    Ok(truncate_ocr_text(&String::from_utf8_lossy(&out.stdout)))
}

fn run_tesseract_best(
    path: &Path,
    exe: &Path,
    tessdata: &Path,
    started: Instant,
) -> Option<OcrCandidate> {
    let mut best: Option<OcrCandidate> = None;
    for psm in TESSERACT_PSM_MODES {
        let Some(timeout) = ocr_attempt_timeout(started) else {
            break;
        };
        let Ok(text) = run_tesseract_with_psm(path, exe, tessdata, psm, timeout) else {
            continue;
        };
        let score = ocr_text_score(&text);
        if text.trim().is_empty() || score == 0 {
            continue;
        }
        let replace = best
            .as_ref()
            .map(|b| score > b.score || (score == b.score && text.len() > b.text.len()))
            .unwrap_or(true);
        if replace {
            best = Some(OcrCandidate {
                text,
                engine: "tesseract",
                score,
            });
        }
        if score >= OCR_EARLY_EXIT_SCORE {
            if let Some(ref b) = best {
                if !is_low_quality_ocr(&b.text) {
                    break;
                }
            }
        }
    }
    best
}

fn resolve_ocr_script() -> Option<PathBuf> {
    let script_name = "yuntu-ocr.ps1";
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

fn run_windows_ocr_script(path: &Path, timeout: Duration) -> Result<String, String> {
    let script = resolve_ocr_script().ok_or_else(|| "未找到内置 OCR 脚本".to_string())?;
    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        &script.to_string_lossy(),
        "-ImagePath",
        &path.to_string_lossy(),
    ]);
    crate::openclaw_exec::hide_console(&mut cmd);
    let Some(out) = crate::openclaw_exec::command_output_timed(cmd, timeout) else {
        return Err(format!("Windows OCR 识别超时（{}s）", timeout.as_secs()));
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Windows OCR 失败: {}", err.trim()));
    }
    Ok(truncate_ocr_text(&String::from_utf8_lossy(&out.stdout)))
}

fn pick_best_candidate(mut candidates: Vec<OcrCandidate>) -> Option<OcrCandidate> {
    candidates.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| b.text.len().cmp(&a.text.len()))
    });
    candidates.into_iter().next()
}

/// 对单张图片执行 OCR（预处理 + Tesseract 多 PSM + Windows OCR 择优）。
pub fn recognize_image_file(path: &Path) -> Result<(String, &'static str), String> {
    if !path.is_file() {
        return Err(format!("不是有效图片: {}", path.display()));
    }
    let size = path.metadata().map_err(|e| e.to_string())?.len();
    if size > MAX_OCR_IMAGE_BYTES {
        return Err(format!(
            "图片 {} 超过 {}MB OCR 上限",
            path.display(),
            MAX_OCR_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if !is_image_name(&name) {
        return Err(format!("不支持的 OCR 图片类型: {name}"));
    }

    let started = Instant::now();
    let preprocessed = preprocess_for_ocr(path).ok();
    let tess_input = preprocessed
        .as_deref()
        .filter(|p| p.is_file())
        .unwrap_or(path);

    let mut candidates: Vec<OcrCandidate> = Vec::new();

    let mut tess_strong = false;
    if let Some((exe, tessdata)) = resolve_tesseract() {
        if let Some(best) = run_tesseract_best(tess_input, &exe, &tessdata, started) {
            tess_strong = best.score >= OCR_EARLY_EXIT_SCORE && !is_low_quality_ocr(&best.text);
            candidates.push(best);
        }
    }

    #[cfg(windows)]
    if !tess_strong {
        if let Some(timeout) = ocr_attempt_timeout(started) {
            if let Ok(text) = run_windows_ocr_script(path, timeout) {
                let score = ocr_text_score(&text);
                if !text.trim().is_empty() && score > 0 {
                    candidates.push(OcrCandidate {
                        text,
                        engine: "windows",
                        score,
                    });
                }
            }
        }
        if candidates.is_empty() {
            if let Some(p) = preprocessed.as_deref() {
                if p != path {
                    if let Some(timeout) = ocr_attempt_timeout(started) {
                        if let Ok(text) = run_windows_ocr_script(p, timeout) {
                            let score = ocr_text_score(&text);
                            if !text.trim().is_empty() && score > 0 {
                                candidates.push(OcrCandidate {
                                    text,
                                    engine: "windows",
                                    score,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(p) = preprocessed.as_ref() {
        let _ = fs::remove_file(p);
    }

    if let Some(best) = pick_best_candidate(candidates) {
        let engine = if best.engine == "tesseract" {
            "tesseract"
        } else {
            "windows"
        };
        return Ok((best.text, engine));
    }

    #[cfg(windows)]
    {
        let Some(timeout) = ocr_attempt_timeout(started) else {
            return Err("单张图片 OCR 超过 45 秒，已停止".into());
        };
        let text = run_windows_ocr_script(path, timeout)?;
        if text.trim().is_empty() {
            return Err("未识别到文字".into());
        }
        Ok((text, "windows"))
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台未配置 OCR 引擎".into())
    }
}

fn ocr_thread_pool() -> &'static rayon::ThreadPool {
    use std::sync::OnceLock;
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(OCR_PARALLEL_THREADS)
            .thread_name(|i| format!("yuntu-ocr-{i}"))
            .build()
            .expect("ocr thread pool")
    })
}

pub fn recognize_image_paths(paths: &[String]) -> Vec<OcrImageResult> {
    use rayon::prelude::*;
    let capped: Vec<String> = paths
        .iter()
        .take(MAX_OCR_IMAGES_PER_BATCH)
        .cloned()
        .collect();
    let mut results: Vec<OcrImageResult> = ocr_thread_pool().install(|| {
        capped
            .par_iter()
            .map(|raw| recognize_one_image_path(raw))
            .collect()
    });
    for raw in paths.iter().skip(MAX_OCR_IMAGES_PER_BATCH) {
        let path = PathBuf::from(raw.trim());
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| raw.clone());
        results.push(OcrImageResult {
            path: path.to_string_lossy().to_string(),
            name,
            text: String::new(),
            engine: String::new(),
            ok: false,
            error: Some(format!(
                "本批最多识别 {MAX_OCR_IMAGES_PER_BATCH} 张，此图已跳过"
            )),
        });
    }
    results
}

fn recognize_one_image_path(raw: &str) -> OcrImageResult {
    let path = PathBuf::from(raw.trim());
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| raw.to_string());
    match recognize_image_file(&path) {
        Ok((text, engine)) => {
            let empty = text.trim().is_empty();
            OcrImageResult {
                path: path.to_string_lossy().to_string(),
                name,
                text,
                engine: engine.to_string(),
                ok: !empty,
                error: if empty {
                    Some("未识别到文字".into())
                } else {
                    None
                },
            }
        }
        Err(e) => OcrImageResult {
            path: path.to_string_lossy().to_string(),
            name,
            text: String::new(),
            engine: "none".into(),
            ok: false,
            error: Some(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_ocr_text_caps_length() {
        let long = "a".repeat(MAX_OCR_OUTPUT_CHARS + 50);
        let t = truncate_ocr_text(&long);
        assert!(t.contains("截断"));
    }

    #[test]
    fn ocr_text_score_prefers_meaningful_text() {
        assert!(ocr_text_score("发票号码 12345678") > ocr_text_score("@@##!!"));
        assert!(ocr_text_score("控制台能力") > ocr_text_score("a"));
    }

    #[test]
    fn pick_best_candidate_uses_score() {
        let best = pick_best_candidate(vec![
            OcrCandidate {
                text: "ab".into(),
                engine: "windows",
                score: 2,
            },
            OcrCandidate {
                text: "云图 OCR 测试".into(),
                engine: "tesseract",
                score: 12,
            },
        ])
        .expect("candidate");
        assert_eq!(best.engine, "tesseract");
        assert!(best.text.contains("云图"));
    }
}
