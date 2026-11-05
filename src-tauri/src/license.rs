//! CPU 绑定反镜像 — 机器指纹采集 + license 离线验证（软件使用的唯一门禁）。
//!
//! - 首次启动：采集 CPU ID + 品牌 + 核心数 + 主机名 -> SHA-256 指纹
//! - 校验文件：`installed_dir/license.dat`（JSON 格式，含签名）
//! - 不匹配 -> 前端弹窗拦截，禁止进入主界面

use crate::db::DbState;
use crate::openclaw_runtime::strip_bom;
use crate::paths::{candidate_install_roots, durable_auth_dir, installed_dir};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

static LICENSE_RECONCILED: AtomicBool = AtomicBool::new(false);
static LICENSE_REMEMBERED: AtomicBool = AtomicBool::new(false);

/// 到期前多少天提示续费（与前端展示一致）
pub const LICENSE_RENEW_SOON_DAYS: i64 = 3;

/// license.dat 的 JSON 结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct LicenseFile {
    /// 目标机器指纹（SHA-256 hex）
    pub fingerprint: String,
    /// 授权签名（v2 绑定签发/到期时间；v1 仅指纹，仅无到期时间的旧版永久授权）
    pub signature: String,
    /// 签发时间（ISO 8601）
    pub issued_at: String,
    /// 可读备注（可选）
    #[serde(default)]
    pub note: String,
    /// 到期时间（ISO 8601 UTC）。缺失表示旧版永久授权（仅兼容历史文件）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

/// 是否启用设备授权拦截。
/// - release 构建默认开启（可用环境变量 `YUNTUAI_LICENSE_REQUIRED=0` 在编译期关闭）
/// - debug 默认关闭；运行时仍可用 `YUNTUAI_LICENSE_REQUIRED=1` 强制开启
fn license_enforcement_enabled() -> bool {
    if let Some(build) = option_env!("YUNTUAI_LICENSE_REQUIRED_AT_BUILD") {
        let t = build.trim();
        if matches!(t, "1" | "true" | "TRUE" | "yes" | "YES") {
            return true;
        }
        if matches!(t, "0" | "false" | "FALSE" | "no" | "NO") {
            // 编译期显式关闭时，仍允许运行时强制开启
        }
    }
    matches!(
        std::env::var("YUNTUAI_LICENSE_REQUIRED")
            .ok()
            .as_deref()
            .map(str::trim),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

/// 激活密钥（供安装封印等本机安全模块复用）。
pub(crate) fn license_activation_secret() -> Result<String, String> {
    activation_secret()
}

/// 激活密钥：编译期嵌入（release）> 环境变量 > 安装目录 activation.secret > dev 固定密钥。
fn activation_secret() -> Result<String, String> {
    if let Some(embedded) = option_env!("YUNTUAI_EMBEDDED_LICENSE_SECRET") {
        let trimmed = embedded.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(value) = std::env::var("YUNTUAI_LICENSE_SECRET") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(dir) = installed_dir() {
        let secret_path = dir.join("activation.secret");
        if secret_path.is_file() {
            let raw = std::fs::read_to_string(&secret_path)
                .map_err(|e| format!("无法读取 activation.secret: {e}"))?;
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        Ok("YUNTUAI-DEV-LICENSE-SECRET".to_string())
    }

    #[cfg(not(debug_assertions))]
    Err("未配置授权密钥（请设置 YUNTUAI_LICENSE_SECRET 或部署 activation.secret）".into())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub licensed: bool,
    pub fingerprint: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    pub expired: bool,
    pub renew_soon: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_remaining: Option<i64>,
}

#[derive(Debug, Clone)]
struct LicenseEvaluation {
    signature_ok: bool,
    fingerprint_ok: bool,
    expires_at: Option<DateTime<Utc>>,
    expired: bool,
    renew_soon: bool,
    days_remaining: Option<i64>,
}

fn parse_expires_at(raw: &str) -> Result<DateTime<Utc>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("到期时间为空".to_string());
    }
    DateTime::parse_from_rfc3339(trimmed)
        .map(|dt| dt.with_timezone(&Utc))
        .or_else(|_| {
            trimmed
                .parse::<DateTime<Utc>>()
                .map_err(|e| format!("到期时间格式无效: {e}"))
        })
}

fn evaluate_expiry(expires_at: Option<&DateTime<Utc>>, now: DateTime<Utc>) -> (bool, bool, Option<i64>) {
    let Some(exp) = expires_at else {
        return (false, false, None);
    };
    if now > *exp {
        return (true, false, Some(0));
    }
    let days = (*exp - now).num_days();
    let renew_soon = days <= LICENSE_RENEW_SOON_DAYS;
    (false, renew_soon, Some(days.max(0)))
}

fn format_expiry_local(exp: DateTime<Utc>) -> String {
    exp.with_timezone(&chrono::Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

/// 签名用时间：UTC 秒级 Unix 时间戳，避免不同工具 RFC3339 格式差异。
fn timestamp_secs_for_sign(raw: &str) -> Result<String, String> {
    Ok(parse_expires_at(raw)?.timestamp().to_string())
}

/// v2 授权签名：SHA-256("v2:" + fingerprint + "|" + issued_secs + "|" + expires_secs + secret)
/// `expires_at` 缺省时 expires_secs 为空字符串（永久授权）。
fn sign_license_v2(
    fingerprint: &str,
    issued_at: &str,
    expires_at: &Option<String>,
) -> Result<String, String> {
    let fp = normalize_fingerprint(fingerprint)?;
    let secret = activation_secret()?;
    let issued = timestamp_secs_for_sign(issued_at)?;
    let exp = match expires_at {
        Some(raw) => timestamp_secs_for_sign(raw)?,
        None => String::new(),
    };
    let mut hasher = Sha256::new();
    hasher.update(b"v2:");
    hasher.update(fp.as_bytes());
    hasher.update(b"|");
    hasher.update(issued.as_bytes());
    hasher.update(b"|");
    hasher.update(exp.as_bytes());
    hasher.update(secret.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

/// 验证 license 签名。含 `expires_at` 的授权必须使用 v2；仅无到期时间的旧版可用 v1。
fn verify_license_signature(license: &LicenseFile) -> Result<bool, String> {
    let fp = normalize_fingerprint(&license.fingerprint)?;
    let v2_expected = sign_license_v2(&fp, &license.issued_at, &license.expires_at)?;
    if license.signature.trim().eq_ignore_ascii_case(&v2_expected) {
        return Ok(true);
    }
    if license.expires_at.is_some() {
        return Ok(false);
    }
    let legacy = sign_fingerprint(&fp)?;
    Ok(license.signature.trim().eq_ignore_ascii_case(&legacy))
}

fn evaluate_license(license: &LicenseFile, current_fp: &str, now: DateTime<Utc>) -> Result<LicenseEvaluation, String> {
    let licensed_fp = normalize_fingerprint(&license.fingerprint)?;
    let fingerprint_ok = fingerprint_matches_this_device(&licensed_fp, current_fp);
    let signature_ok = verify_license_signature(license)?;

    let expires_at = match license.expires_at.as_deref() {
        Some(raw) => Some(parse_expires_at(raw)?),
        None => None,
    };
    let (expired, renew_soon, days_remaining) = evaluate_expiry(expires_at.as_ref(), now);

    Ok(LicenseEvaluation {
        signature_ok,
        fingerprint_ok,
        expires_at,
        expired,
        renew_soon,
        days_remaining,
    })
}

fn license_status_from_evaluation(
    fingerprint: String,
    eval: &LicenseEvaluation,
) -> LicenseStatus {
    let expires_at = eval.expires_at.map(|dt| dt.to_rfc3339());
    let expiry_label = eval
        .expires_at
        .map(format_expiry_local);

    if !eval.signature_ok || !eval.fingerprint_ok {
        let message = if !eval.fingerprint_ok {
            format!(
                "未授权设备。请将机器指纹提供给管理员以获取授权。\n指纹: {}",
                fingerprint
            )
        } else {
            "授权签名无效（密钥不匹配、到期时间被篡改或需重新签发授权）".to_string()
        };
        return LicenseStatus {
            licensed: false,
            fingerprint,
            expired: false,
            renew_soon: false,
            days_remaining: None,
            expires_at,
            message,
        };
    }

    if eval.expired {
        return LicenseStatus {
            licensed: false,
            fingerprint,
            expired: true,
            renew_soon: false,
            days_remaining: Some(0),
            expires_at,
            message: expiry_label
                .map(|d| format!("授权已于 {d} 到期，请联系续费后粘贴新授权。"))
                .unwrap_or_else(|| "授权已到期，请联系续费后粘贴新授权。".to_string()),
        };
    }

    let message = match expiry_label {
        Some(d) if eval.renew_soon => {
            let days = eval.days_remaining.unwrap_or(0);
            format!(
                "已授权，将于 {d} 到期（剩余约 {days} 天），请提前续费。"
            )
        }
        Some(d) => format!("已授权，有效期至 {d}。"),
        None => "已授权（未设置到期时间，旧版授权）。".to_string(),
    };

    LicenseStatus {
        licensed: true,
        fingerprint,
        expired: false,
        renew_soon: eval.renew_soon,
        days_remaining: eval.days_remaining,
        expires_at,
        message,
    }
}

fn read_license_file(license_path: &PathBuf) -> Result<LicenseFile, String> {
    if !license_path.exists() {
        return Err("missing".to_string());
    }
    let raw = std::fs::read_to_string(license_path)
        .map_err(|e| format!("无法读取 license 文件: {e}"))?;
    serde_json::from_str(strip_bom(&raw)).map_err(|e| format!("license 文件格式无效: {e}"))
}

use std::sync::OnceLock;

/// 采集当前机器的硬件指纹（进程内缓存，避免每条 IPC 重复 CPUID/哈希）。
pub(crate) fn machine_fingerprint() -> Result<String, String> {
    static FP: OnceLock<Result<String, String>> = OnceLock::new();
    FP.get_or_init(compute_machine_fingerprint)
        .clone()
}

fn compute_machine_fingerprint() -> Result<String, String> {
    let mut hasher = Sha256::new();

    // CPU 信息（raw-cpuid 仅在 x86/x86_64 可用）
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        let cpuid = raw_cpuid::CpuId::new();
        if let Some(vendor) = cpuid.get_vendor_info() {
            hasher.update(vendor.as_str().as_bytes());
        }
        if let Some(brand) = cpuid.get_processor_brand_string() {
            hasher.update(brand.as_str().as_bytes());
        }
        if let Some(feature) = cpuid.get_feature_info() {
            hasher.update(feature.family_id().to_le_bytes());
            hasher.update(feature.model_id().to_le_bytes());
            hasher.update(feature.stepping_id().to_le_bytes());
        }
    }

    // 核心数（逻辑处理器）
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    hasher.update((cores as u64).to_le_bytes());

    // 主机名
    if let Ok(host) = hostname::get() {
        if let Some(h) = host.to_str() {
            hasher.update(h.as_bytes());
        }
    }

    let result = hasher.finalize();
    Ok(hex::encode(result))
}

/// 规范化机器指纹（64 位小写 hex）
fn normalize_fingerprint(fingerprint: &str) -> Result<String, String> {
    let fp = fingerprint.trim().to_ascii_lowercase();
    if fp.len() != 64 || !fp.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("指纹格式无效（应为 64 位 hex）".to_string());
    }
    Ok(fp)
}

/// 生成授权签名：SHA-256(fingerprint + secret) — 仅 v1 永久授权兼容；新签发请用 `sign_license_v2`。
pub(crate) fn sign_fingerprint(fingerprint: &str) -> Result<String, String> {
    let fp = normalize_fingerprint(fingerprint)?;
    let secret = activation_secret()?;
    let mut hasher = Sha256::new();
    hasher.update(fp.as_bytes());
    hasher.update(secret.as_bytes());
    Ok(hex::encode(hasher.finalize()))
}

/// 验证 license 文件签名是否与当前机器匹配，且未过期。
pub(crate) fn verify_license(license_path: &PathBuf) -> Result<bool, String> {
    let current = machine_fingerprint()?;
    let license = match read_license_file(license_path) {
        Ok(l) => l,
        Err(e) if e == "missing" => return Ok(false),
        Err(e) => return Err(e),
    };
    let eval = evaluate_license(&license, &current, Utc::now())?;
    Ok(eval.signature_ok && eval.fingerprint_ok && !eval.expired)
}

/// 升级后从兄弟安装目录回收仍有效的 license.dat，保留原到期时间。
pub(crate) fn reconcile_license_on_startup() -> Result<bool, String> {
    if !license_enforcement_enabled() {
        return Ok(false);
    }
    if LICENSE_RECONCILED.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }

    let dir = installed_dir()?;
    let primary = dir.join("license.dat");
    if verify_license(&primary).unwrap_or(false) {
        remember_active_license(&primary);
        return Ok(false);
    }

    let mut best: Option<(i64, PathBuf)> = None;
    for root in candidate_install_roots()? {
        for alt in license_candidate_paths(&root) {
            if alt == primary {
                continue;
            }
            if !verify_license_for_restore(&alt).unwrap_or(false) {
                continue;
            }
            let score = read_license_file(&alt)
                .ok()
                .map(|lic| license_expiry_score(&lic))
                .unwrap_or(0);
            if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                best = Some((score, alt));
            }
        }
    }

    let Some((_, source)) = best else {
        return Ok(false);
    };

    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建安装目录: {e}"))?;
    if primary.is_file() {
        let bak = dir.join("license.dat.pre-reconcile.bak");
        let _ = std::fs::copy(&primary, &bak);
    }
    std::fs::copy(&source, &primary)
        .map_err(|e| format!("无法恢复 license.dat: {e}"))?;
    remember_active_license(&primary);
    eprintln!(
        "[YunTuAI] license reconcile: restored valid license from {}",
        source.display()
    );
    Ok(true)
}

fn license_expiry_score(license: &LicenseFile) -> i64 {
    match license.expires_at.as_deref() {
        Some(raw) => parse_expires_at(raw)
            .ok()
            .map(|dt| dt.timestamp())
            .unwrap_or(0),
        None => i64::MAX,
    }
}

fn license_candidate_paths(root: &Path) -> Vec<PathBuf> {
    [
        "license.dat",
        "license.dat.bak",
        "license.dat.pre-reconcile.bak",
    ]
    .into_iter()
    .map(|name| root.join(name))
    .collect()
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct DeviceBindFile {
    #[serde(default)]
    fingerprints: Vec<String>,
}

fn device_bind_path() -> Result<PathBuf, String> {
    Ok(durable_auth_dir()?.join("device-bind.json"))
}

fn read_known_fingerprints() -> Vec<String> {
    let Ok(path) = device_bind_path() else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<DeviceBindFile>(strip_bom(&raw))
        .map(|f| f.fingerprints)
        .unwrap_or_default()
}

fn fingerprint_matches_this_device(licensed_fp: &str, current_fp: &str) -> bool {
    if licensed_fp.eq_ignore_ascii_case(current_fp) {
        return true;
    }
    read_known_fingerprints()
        .iter()
        .any(|fp| fp.eq_ignore_ascii_case(licensed_fp))
}

fn record_known_fingerprint(fp: &str) {
    let Ok(normalized) = normalize_fingerprint(fp) else {
        return;
    };
    let mut known = read_known_fingerprints();
    if known.iter().any(|x| x.eq_ignore_ascii_case(&normalized)) {
        return;
    }
    known.push(normalized);
    if known.len() > 8 {
        let drain = known.len() - 8;
        known.drain(0..drain);
    }
    let Ok(path) = device_bind_path() else {
        return;
    };
    if let Ok(json) = serde_json::to_string_pretty(&DeviceBindFile {
        fingerprints: known,
    }) {
        let _ = std::fs::write(path, format!("{json}\n"));
    }
}

fn persist_license_copy(license_json: &str, dest: &PathBuf) {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(dest, license_json);
}

fn persist_license_backups(license_json: &str) {
    if let Ok(auth) = durable_auth_dir() {
        persist_license_copy(license_json, &auth.join("license.dat"));
        persist_license_copy(license_json, &auth.join("license.dat.bak"));
    }
}

fn remember_active_license(license_path: &PathBuf) {
    if LICENSE_REMEMBERED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(raw) = std::fs::read_to_string(license_path) {
        persist_license_backups(&raw);
    }
    if let Ok(fp) = machine_fingerprint() {
        record_known_fingerprint(&fp);
    }
    if let Ok(lic) = read_license_file(license_path) {
        record_known_fingerprint(&lic.fingerprint);
    }
}

fn license_in_durable_dir(license_path: &Path) -> bool {
    durable_auth_dir()
        .ok()
        .and_then(|d| {
            std::fs::canonicalize(&d).ok().and_then(|auth| {
                license_path
                    .parent()
                    .and_then(|p| std::fs::canonicalize(p).ok())
                    .map(|parent| parent == auth)
            })
        })
        .unwrap_or_else(|| {
            license_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                == Some("YunTuAI-Auth")
        })
}

fn verify_license_for_restore(license_path: &PathBuf) -> Result<bool, String> {
    let current = machine_fingerprint()?;
    let license = match read_license_file(license_path) {
        Ok(l) => l,
        Err(e) if e == "missing" => return Ok(false),
        Err(e) => return Err(e),
    };
    let eval = evaluate_license(&license, &current, Utc::now())?;
    if eval.signature_ok && eval.fingerprint_ok && !eval.expired {
        return Ok(true);
    }
    if license_in_durable_dir(license_path) && eval.signature_ok && !eval.expired {
        return Ok(true);
    }
    Ok(false)
}

/// 敏感 IPC / 后台服务：要求本机 license.dat 校验通过（未开启 enforcement 时恒为 Ok）。
pub(crate) fn assert_licensed() -> Result<(), String> {
    if !license_enforcement_enabled() {
        return Ok(());
    }

    let _ = reconcile_license_on_startup();

    let dir = installed_dir()?;
    let license_path = dir.join("license.dat");

    #[cfg(debug_assertions)]
    if !license_path.exists() {
        return Ok(());
    }

    match verify_license(&license_path) {
        Ok(true) => {
            remember_active_license(&license_path);
            Ok(())
        }
        Ok(false) => Err("设备未授权或授权已到期，请续费后重新激活。".into()),
        Err(e) => Err(format!("授权验证失败: {e}")),
    }
}

/// 启动时检查授权状态
#[tauri::command]
pub async fn check_license() -> Result<LicenseStatus, String> {
    crate::ipc::run_blocking(check_license_inner).await
}

fn check_license_inner() -> Result<LicenseStatus, String> {
    if !license_enforcement_enabled() {
        let fingerprint = machine_fingerprint().unwrap_or_default();
        return Ok(LicenseStatus {
            licensed: true,
            fingerprint,
            message: "设备授权已关闭（如需启用请设置 YUNTUAI_LICENSE_REQUIRED=1）".to_string(),
            expires_at: None,
            expired: false,
            renew_soon: false,
            days_remaining: None,
        });
    }

    let _ = reconcile_license_on_startup();

    let fingerprint = machine_fingerprint()?;
    let dir = installed_dir()?;
    let license_path = dir.join("license.dat");

    #[cfg(debug_assertions)]
    if !license_path.exists() {
        return Ok(LicenseStatus {
            licensed: true,
            fingerprint,
            message: "开发模式：未检测到 license.dat，已跳过授权".to_string(),
            expires_at: None,
            expired: false,
            renew_soon: false,
            days_remaining: None,
        });
    }

    let license = match read_license_file(&license_path) {
        Ok(l) => l,
        Err(e) if e == "missing" => {
            return Ok(LicenseStatus {
                licensed: false,
                fingerprint: fingerprint.clone(),
                expired: false,
                renew_soon: false,
                days_remaining: None,
                expires_at: None,
                message: format!(
                    "未授权设备。请将机器指纹提供给管理员以获取授权。\n指纹: {}",
                    fingerprint
                ),
            });
        }
        Err(e) => {
            return Ok(LicenseStatus {
                licensed: false,
                fingerprint,
                expired: false,
                renew_soon: false,
                days_remaining: None,
                expires_at: None,
                message: format!("授权验证出错: {e}"),
            });
        }
    };

    match evaluate_license(&license, &fingerprint, Utc::now()) {
        Ok(eval) => {
            let status = license_status_from_evaluation(fingerprint, &eval);
            if status.licensed {
                remember_active_license(&license_path);
            }
            Ok(status)
        }
        Err(e) => Ok(LicenseStatus {
            licensed: false,
            fingerprint,
            expired: false,
            renew_soon: false,
            days_remaining: None,
            expires_at: None,
            message: format!("授权验证出错: {e}"),
        }),
    }
}

/// 管理员工具：根据机器指纹生成 license.dat 内容（需管理员会话）。
#[tauri::command]
pub fn generate_license_content(
    state: tauri::State<crate::db::DbState>,
    token: String,
    fingerprint: String,
    note: Option<String>,
    valid_days: Option<u32>,
) -> Result<String, String> {
    crate::owner::assert_owner(&state, &token)?;

    let fp = normalize_fingerprint(&fingerprint)?;
    let note_text = note
        .unwrap_or_default()
        .trim()
        .to_string();
    let days = valid_days.unwrap_or(30).max(1);
    let issued = Utc::now();
    let expires = issued + Duration::days(days as i64);
    let issued_at = issued.to_rfc3339();
    let expires_at = Some(expires.to_rfc3339());
    let signature = sign_license_v2(&fp, &issued_at, &expires_at)?;
    let license = LicenseFile {
        fingerprint: fp.clone(),
        signature,
        issued_at,
        expires_at,
        note: if note_text.is_empty() {
            format!("YunTuAI 设备授权 · {days} 天")
        } else {
            note_text
        },
    };

    serde_json::to_string_pretty(&license).map_err(|e| format!("序列化失败: {e}"))
}

/// 当前 license 是否仍有效且无需用户自助更换（未到期且非「即将到期」）。
fn active_license_blocks_replacement(license_path: &PathBuf) -> Result<bool, String> {
    if !license_path.is_file() {
        return Ok(false);
    }
    let current = machine_fingerprint()?;
    let license = match read_license_file(license_path) {
        Ok(l) => l,
        Err(e) if e == "missing" => return Ok(false),
        Err(e) => return Err(e),
    };
    let eval = evaluate_license(&license, &current, Utc::now())?;
    Ok(eval.signature_ok && eval.fingerprint_ok && !eval.expired && !eval.renew_soon)
}

/// 前端调用：写入 license 文件。
/// 未授权 / 已到期 / 即将到期可自助激活；有效授权期内更换需 Owner。
#[tauri::command]
pub fn install_license(
    state: tauri::State<'_, DbState>,
    token: String,
    content: String,
) -> Result<LicenseStatus, String> {
    crate::auth::assert_authenticated(&state, &token)?;
    let dir = installed_dir()?;
    let license_path = dir.join("license.dat");
    if active_license_blocks_replacement(&license_path)? {
        crate::owner::assert_owner(&state, &token)?;
    }
    write_and_verify_license(&content, &license_path)
}

/// 未登录首次激活：未授权、已到期或即将到期时可写入 license.dat。
#[tauri::command]
pub fn activate_license(content: String) -> Result<LicenseStatus, String> {
    if !license_enforcement_enabled() {
        return check_license_inner();
    }
    let dir = installed_dir()?;
    let license_path = dir.join("license.dat");
    if active_license_blocks_replacement(&license_path)? {
        return Err("设备已授权且仍在有效期内。如需提前更换授权请联系管理员。".into());
    }
    write_and_verify_license(&content, &license_path)
}

fn write_and_verify_license(content: &str, license_path: &PathBuf) -> Result<LicenseStatus, String> {
    let mut license: LicenseFile =
        serde_json::from_str(strip_bom(content)).map_err(|e| format!("license 内容无效: {e}"))?;

    let current = machine_fingerprint()?;
    let licensed_fp = normalize_fingerprint(&license.fingerprint)?;
    if !fingerprint_matches_this_device(&licensed_fp, &current) {
        return Err("license 与当前设备不匹配".to_string());
    }

    if !verify_license_signature(&license)? {
        return Err("license 签名无效（密钥不匹配、到期时间被篡改或需重新签发授权）".to_string());
    }

    let eval = evaluate_license(&license, &current, Utc::now())?;
    if eval.expired {
        return Err(
            eval.expires_at
                .map(|exp| format!("授权已于 {} 到期，请续费后使用新授权。", format_expiry_local(exp)))
                .unwrap_or_else(|| "授权已到期，请续费后使用新授权。".to_string()),
        );
    }

    license.fingerprint = licensed_fp.clone();
    let normalized =
        serde_json::to_string_pretty(&license).map_err(|e| format!("序列化失败: {e}"))?;
    let body = format!("{normalized}\n");
    if let Some(parent) = license_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("无法创建安装目录: {e}"))?;
    }
    std::fs::write(license_path, &body).map_err(|e| format!("写入失败: {e}"))?;
    persist_license_backups(&body);
    record_known_fingerprint(&current);
    record_known_fingerprint(&licensed_fp);

    Ok(LicenseStatus {
        licensed: true,
        fingerprint: current,
        expired: false,
        renew_soon: eval.renew_soon,
        days_remaining: eval.days_remaining,
        expires_at: eval.expires_at.map(|dt| dt.to_rfc3339()),
        message: "授权成功".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn license_enforcement_defaults_off() {
        std::env::remove_var("YUNTUAI_LICENSE_REQUIRED");
        assert!(!license_enforcement_enabled());
    }

    #[test]
    fn license_enforcement_respects_env_flag() {
        std::env::set_var("YUNTUAI_LICENSE_REQUIRED", "1");
        assert!(license_enforcement_enabled());
        std::env::remove_var("YUNTUAI_LICENSE_REQUIRED");
    }

    #[test]
    fn assert_licensed_ok_when_enforcement_disabled_in_dev() {
        if license_enforcement_enabled() {
            return;
        }
        assert!(assert_licensed().is_ok());
    }

    #[test]
    fn sign_fingerprint_normalizes_hex_case() {
        let fp = machine_fingerprint().expect("fingerprint");
        let upper = fp.to_ascii_uppercase();
        let lower = sign_fingerprint(&fp).expect("lower");
        let mixed = sign_fingerprint(&upper).expect("upper");
        assert_eq!(lower, mixed);
    }

    fn sample_v2_license(fp: &str, issued: DateTime<Utc>, expires: Option<DateTime<Utc>>) -> LicenseFile {
        let issued_at = issued.to_rfc3339();
        let expires_at = expires.map(|dt| dt.to_rfc3339());
        let signature = sign_license_v2(fp, &issued_at, &expires_at).expect("sign v2");
        LicenseFile {
            fingerprint: fp.to_string(),
            signature,
            issued_at,
            expires_at,
            note: "test".to_string(),
        }
    }

    #[test]
    fn expired_license_is_not_active() {
        let fp = machine_fingerprint().expect("fingerprint");
        let license = sample_v2_license(
            &fp,
            Utc::now() - Duration::days(40),
            Some(Utc::now() - Duration::days(1)),
        );
        let eval = evaluate_license(&license, &license.fingerprint, Utc::now()).expect("eval");
        assert!(eval.signature_ok);
        assert!(eval.expired);
        assert!(!eval.renew_soon);
    }

    #[test]
    fn tampered_expires_at_breaks_v2_signature() {
        let fp = machine_fingerprint().expect("fingerprint");
        let mut license = sample_v2_license(
            &fp,
            Utc::now(),
            Some(Utc::now() + Duration::days(30)),
        );
        license.expires_at = Some((Utc::now() + Duration::days(365)).to_rfc3339());
        let eval = evaluate_license(&license, &fp, Utc::now()).expect("eval");
        assert!(!eval.signature_ok);
    }

    #[test]
    fn v1_signature_rejected_when_expires_at_present() {
        let fp = machine_fingerprint().expect("fingerprint");
        let sig = sign_fingerprint(&fp).expect("sign");
        let license = LicenseFile {
            fingerprint: fp.clone(),
            signature: sig,
            issued_at: Utc::now().to_rfc3339(),
            expires_at: Some((Utc::now() + Duration::days(30)).to_rfc3339()),
            note: "legacy-v1-with-expiry".to_string(),
        };
        let eval = evaluate_license(&license, &fp, Utc::now()).expect("eval");
        assert!(!eval.signature_ok);
    }

    #[test]
    fn renew_soon_allows_replacement() {
        let fp = machine_fingerprint().expect("fingerprint");
        let license = sample_v2_license(&fp, Utc::now(), Some(Utc::now() + Duration::days(2)));
        let dir = std::env::temp_dir().join(format!("yuntuai-lic-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("license.dat");
        let json = serde_json::to_string_pretty(&license).expect("json");
        std::fs::write(&path, json).expect("write");
        assert!(!active_license_blocks_replacement(&path).expect("blocks"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn renew_soon_within_three_days() {
        let fp = machine_fingerprint().expect("fingerprint");
        let license = sample_v2_license(&fp, Utc::now(), Some(Utc::now() + Duration::days(2)));
        let eval = evaluate_license(&license, &fp, Utc::now()).expect("eval");
        assert!(eval.signature_ok);
        assert!(!eval.expired);
        assert!(eval.renew_soon);
    }

    #[test]
    fn fingerprint_history_accepts_previous_bind() {
        let current = machine_fingerprint().expect("fp");
        assert!(fingerprint_matches_this_device(&current, &current));
        let other = "ab".repeat(32);
        record_known_fingerprint(&other);
        assert!(fingerprint_matches_this_device(&other, &current));
    }

    /// 生成本机开发版 license.dat（密钥: YUNTUAI-DEV-LICENSE-SECRET）
    /// 运行: cargo test print_dev_license -- --nocapture
    #[test]
    fn print_dev_license() {
        let fp = machine_fingerprint().expect("fingerprint");
        let issued = chrono::Utc::now();
        let expires = issued + Duration::days(30);
        let license = sample_v2_license(&fp, issued, Some(expires));
        let json = serde_json::to_string_pretty(&license).expect("json");
        println!("=== DEV LICENSE (machine fingerprint) ===");
        println!("{fp}");
        println!("=== license.dat ===");
        println!("{json}");
    }
}