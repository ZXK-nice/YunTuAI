//! 发行档：内部版 · 云图中转站（产品开关关闭时仅运行内部版）。
//! Release 由 `YUNTUAI_DISTRIBUTION_PROFILE` 编译进二进制；debug 可用 `YUNTUAI_DISTRIBUTION` 覆盖。

use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// 产品级开关：客户中转站发行档。`false` 时即使编译成 relay-station 也按内部版运行。
pub const RELAY_STATION_PRODUCT_ENABLED: bool = true;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DistributionProfile {
    /// 内部版 — DeepSeek / MiMo / 千问多厂商 API Key
    Internal,
    /// 云图中转站 — `YUNTUAI_API_KEY` → 云图中转站 OpenAI 兼容端点
    RelayStation,
}

impl DistributionProfile {
    pub fn id(self) -> &'static str {
        match self {
            Self::Internal => "internal",
            Self::RelayStation => "relay-station",
        }
    }

    pub fn display_label(self) -> &'static str {
        match self {
            Self::Internal => "内部版",
            Self::RelayStation => "云图中转站",
        }
    }

    pub fn product_version(self) -> &'static str {
        env!("CARGO_PKG_VERSION")
    }

    pub fn primary_api_env_key(self) -> &'static str {
        match self {
            Self::Internal => "DEEPSEEK_API_KEY",
            Self::RelayStation => "YUNTUAI_API_KEY",
        }
    }

    /// 内部版：DeepSeek / MiMo / 千问至少配置一家即可。中转站：主 Key 或内嵌 Key。
    pub fn api_env_keys(self) -> &'static [(&'static str, bool)] {
        match self {
            Self::Internal => &[
                ("DEEPSEEK_API_KEY", false),
                ("MIMO_API_KEY", false),
                ("DASHSCOPE_API_KEY", false),
            ],
            Self::RelayStation => &[("YUNTUAI_API_KEY", true)],
        }
    }

    pub fn primary_model(self) -> &'static str {
        match self {
            Self::Internal => "deepseek/deepseek-flash",
            Self::RelayStation => "yuntuai/gpt-5.5",
        }
    }

    /// 视觉回退模型（OpenClaw `agents.defaults.imageModel`）。
    pub fn default_image_model(self) -> Option<&'static str> {
        match self {
            // 内部版默认 DeepSeek V4.1 Flash（原生识图）；无 imageModel 时由会话级视觉模型处理。
            Self::Internal => None,
            Self::RelayStation => Some("yuntuai/gpt-5.5"),
        }
    }

    pub fn provider_id(self) -> &'static str {
        match self {
            Self::Internal => "deepseek",
            Self::RelayStation => "yuntuai",
        }
    }
}

pub fn dev_agnes_enabled() -> bool {
    false
}

/// UI 短 id 对应的 OpenClaw provider。识别厂商时忽略大小写，模型名本身不改写。
pub fn model_provider_for_short(short: &str) -> &'static str {
    let short = short.trim();
    if let Some(id) = crate::llm_user_providers::provider_id_for_model(short) {
        return id;
    }
    let lower = short.to_ascii_lowercase();
    if lower.starts_with("qwen") {
        return "qwen";
    }
    if lower.starts_with("mimo") {
        return "mimo";
    }
    if lower.starts_with("glm") {
        return "zhipu";
    }
    if lower.starts_with("kimi") || lower.starts_with("moonshot") {
        return "moonshot";
    }
    if lower.starts_with("doubao") || lower.starts_with("ep-") {
        return "ark";
    }
    if lower.starts_with("minimax") || lower.starts_with("abab") {
        return "minimax";
    }
    if lower.starts_with("spark") || lower.starts_with("generalv") {
        return "spark";
    }
    active_distribution_profile().provider_id()
}

fn env_has_nonempty(env_map: &HashMap<String, String>, key: &str) -> bool {
    env_map
        .get(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// 按已配置的厂商 Key 选择默认主模型（多家都有时优先 DeepSeek）。
pub fn preferred_primary_model_for_env_keys(env_map: &HashMap<String, String>) -> Option<String> {
    if env_has_nonempty(env_map, "DEEPSEEK_API_KEY") {
        return Some(qualify_model_id("deepseek-flash"));
    }
    if env_has_nonempty(env_map, "MIMO_API_KEY") {
        return Some(qualify_model_id("mimo-v2.6-pro"));
    }
    if env_has_nonempty(env_map, "DASHSCOPE_API_KEY") {
        return Some(qualify_model_id("qwen3.6-flash"));
    }
    crate::llm_user_providers::preferred_extra_model(env_map)
}

/// 当前主模型对应的厂商 Key 是否仍在 .env 中。
pub fn primary_model_has_configured_key(model: &str, env_map: &HashMap<String, String>) -> bool {
    let m = model.to_ascii_lowercase();
    if m.contains("mimo") {
        return env_has_nonempty(env_map, "MIMO_API_KEY");
    }
    if m.contains("qwen") || m.contains("dashscope") {
        return env_has_nonempty(env_map, "DASHSCOPE_API_KEY");
    }
    if m.contains("deepseek") {
        return env_has_nonempty(env_map, "DEEPSEEK_API_KEY");
    }
    for preset in crate::llm_user_providers::LLM_PRESETS {
        if m.contains(preset.id) || m.contains(&preset.env_key.to_ascii_lowercase()) {
            return env_has_nonempty(env_map, preset.env_key);
        }
    }
    crate::llm_user_providers::any_extra_key_configured(env_map)
}

fn canonical_known_model_token(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let folded = trimmed
        .to_ascii_lowercase()
        .replace([' ', '_'], "-")
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    const KNOWN: &[&str] = &[
        "mimo-v2.6-pro",
        "mimo-v2.6-flash",
        "mimo-v2.6-pro-ultraspeed",
        "mimo-v2.5",
        "mimo-v2.5-pro",
        "deepseek-flash",
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "qwen3.6-flash",
        "qwen3.6-plus",
        "qwen3.7-plus",
        "qwen3.7-max",
    ];
    if KNOWN.contains(&folded.as_str()) {
        folded
    } else {
        trimmed.to_string()
    }
}

fn is_known_provider_prefix(head: &str) -> bool {
    let head = head.trim().to_ascii_lowercase();
    matches!(
        head.as_str(),
        "deepseek"
            | "qwen"
            | "mimo"
            | "yuntuai"
            | "zhipu"
            | "moonshot"
            | "ark"
            | "siliconflow"
            | "minimax"
            | "spark"
            | "custom"
            | "openai"
            | "anthropic"
    )
}

/// 只按已知厂商前缀切开。用户模型 ID 里的斜杠保持原文，避免被当成另一个厂商。
fn split_known_provider(raw: &str) -> (Option<&str>, &str) {
    match raw.split_once('/') {
        Some((provider, model)) if is_known_provider_prefix(provider) => {
            (Some(provider.trim()), model.trim())
        }
        _ => (None, raw),
    }
}

/// UI 短 id 或已带前缀的 id → OpenClaw 全名。已知模型收成接口 ID，未知 ID 保持原文。
pub fn qualify_model_id(short_id: &str) -> String {
    let raw = short_id.trim();
    if raw.is_empty() {
        return active_distribution_profile().primary_model().to_string();
    }
    let (given_provider, model) = split_known_provider(raw);
    let model = canonical_known_model_token(model);
    if model.is_empty() {
        return active_distribution_profile().primary_model().to_string();
    }
    if active_distribution_profile() == DistributionProfile::RelayStation {
        if is_relay_catalog_model(&model) {
            return format!("yuntuai/{model}");
        }
        return active_distribution_profile().primary_model().to_string();
    }
    let expected = model_provider_for_short(&model);
    let default_provider = active_distribution_profile().provider_id();
    if expected != default_provider {
        return format!("{expected}/{model}");
    }
    if let Some(provider) = given_provider.filter(|p| !p.is_empty()) {
        return format!("{provider}/{model}");
    }
    format!("{expected}/{model}")
}

/// OpenClaw 全名 → UI 短 id。
pub fn short_model_id(full_id: &str) -> String {
    full_id
        .rsplit('/')
        .next()
        .unwrap_or(full_id)
        .to_string()
}

/// 中转站发行档：API Key 由安装包注入，用户不可改。
pub fn api_key_locked() -> bool {
    active_distribution_profile() == DistributionProfile::RelayStation
}

/// 中转站发行档：允许持续自助注册。
pub fn open_registration() -> bool {
    active_distribution_profile() == DistributionProfile::RelayStation
}

/// 登录密码：中转站与内部版相同，至少 8 位且同时含英文字母与数字（2026-09-29 产品确认）。
pub fn uses_eight_digit_login_password() -> bool {
    false
}

/// 会话 token 有效期（毫秒）。
pub fn token_expiry_ms() -> i64 {
    match active_distribution_profile() {
        DistributionProfile::RelayStation => 7 * 24 * 60 * 60 * 1000,
        DistributionProfile::Internal => 30 * 24 * 60 * 60 * 1000,
    }
}

/// 编译进 release 的中转站 API Key（仅 relay-station 发行包）。
pub fn embedded_relay_api_key() -> Option<&'static str> {
    if active_distribution_profile() != DistributionProfile::RelayStation {
        return None;
    }
    option_env!("YUNTUAI_EMBEDDED_RELAY_API_KEY").filter(|s| !s.is_empty())
}

pub fn default_model_short_id() -> &'static str {
    "deepseek-flash"
}

/// 中转站上架模型（2026-09-29 对照 https://api.doohuan.com/api/pricing）。id, 显示名, contextWindow。
const RELAY_CATALOG: &[(&str, &str, u64)] = &[
    ("gpt-5.5", "GPT 5.5", 1_153_434),
    ("gpt-5.5-pro", "GPT 5.5 Pro", 1_153_434),
    ("gpt-5.4", "GPT 5.4", 1_153_434),
    ("gpt-5.4-mini", "GPT 5.4 Mini", 409_600),
    ("claude-opus-4-8", "Claude Opus 4.8", 1_048_576),
    ("claude-opus-4-7", "Claude Opus 4.7", 1_048_576),
    ("claude-opus-4-6", "Claude Opus 4.6", 1_048_576),
    ("claude-opus-4-5-20251101", "Claude Opus 4.5", 204_800),
    ("claude-sonnet-5", "Claude Sonnet 5", 1_048_576),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6", 1_048_576),
    ("claude-sonnet-4-5-20250929", "Claude Sonnet 4.5", 1_048_576),
    ("claude-sonnet-4-20250514", "Claude Sonnet 4", 204_800),
    ("claude-haiku-4-5-20251001", "Claude Haiku 4.5", 204_800),
    ("claude-fable-5", "Claude Fable 5", 1_048_576),
    ("deepseek-v4-pro", "DeepSeek V4 Pro", 1_048_576),
    ("deepseek-v4-flash", "DeepSeek V4 Flash", 1_048_576),
    ("deepseek-v3.1", "DeepSeek V3.1", 131_072),
    ("qwen3.5-plus", "Qwen3.5 Plus", 1_048_576),
    ("qwen3.5-flash", "Qwen3.5 Flash", 1_048_576),
    ("glm-5.2", "GLM 5.2", 1_048_576),
    ("glm-5.1", "GLM 5.1", 204_800),
    ("glm-5", "GLM 5", 209_715),
    ("glm-5-turbo", "GLM 5 Turbo", 204_800),
    ("glm-5v-turbo", "GLM 5V Turbo", 204_800),
    ("kimi-k2.6", "Kimi K2.6", 268_390),
    ("kimi-k2.5", "Kimi K2.5", 268_390),
    ("kimi-k2.7-code", "Kimi K2.7 Code", 268_390),
    ("kimi-k2.7-code-highspeed", "Kimi K2.7 Code Highspeed", 268_390),
    ("minimax-m3", "MiniMax M3", 1_048_576),
    ("minimax-m2.7", "MiniMax M2.7", 209_715),
    ("minimax-m2.5", "MiniMax M2.5", 209_715),
    ("hy3-preview", "腾讯 Hy3 Preview", 262_144),
];

pub fn is_relay_catalog_model(model: &str) -> bool {
    let short = model.rsplit('/').next().unwrap_or(model).trim();
    RELAY_CATALOG.iter().any(|(id, _, _)| *id == short)
}

/// 当前发行档可选模型（与 seed/repair 清单一致）。
pub fn available_models() -> Vec<(&'static str, &'static str)> {
    match active_distribution_profile() {
        DistributionProfile::Internal => vec![
            ("deepseek-flash", "DeepSeek V4.1 Flash"),
            ("deepseek-v4-pro", "DeepSeek V4 Pro"),
            ("mimo-v2.6-pro", "MiMo V2.6 Pro"),
            ("mimo-v2.6-flash", "MiMo V2.6 Flash"),
            ("mimo-v2.5", "MiMo V2.5"),
            ("mimo-v2.5-pro", "MiMo V2.5 Pro"),
            ("qwen3.6-flash", "Qwen3.6 Flash"),
            ("qwen3.6-plus", "Qwen3.6 Plus"),
            ("qwen3.7-plus", "Qwen3.7 Plus"),
            ("qwen3.7-max", "Qwen3.7 Max"),
        ],
        DistributionProfile::RelayStation => RELAY_CATALOG
            .iter()
            .map(|(id, name, _)| (*id, *name))
            .collect(),
    }
}

#[cfg(debug_assertions)]
fn parse_profile_id(raw: &str) -> DistributionProfile {
    match raw.trim().to_ascii_lowercase().as_str() {
        "relay" | "relay-station" | "yuntuai" | "yuntuai-relay" => DistributionProfile::RelayStation,
        "internal" | "deepseek-direct" | "deepseek" => DistributionProfile::Internal,
        _ => DistributionProfile::Internal,
    }
}

fn compile_time_profile() -> DistributionProfile {
    // 单元测试固定内部版，避免 `pkg:release:relay` 把测试二进制也编成中转站后断言全倒。
    // 正式 release 二进制仍读取 YUNTUAI_DISTRIBUTION_PROFILE。
    #[cfg(test)]
    {
        DistributionProfile::Internal
    }
    #[cfg(not(test))]
    {
        match option_env!("YUNTUAI_DISTRIBUTION_PROFILE") {
            Some("relay-station") => DistributionProfile::RelayStation,
            Some("internal") | Some("deepseek-direct") => DistributionProfile::Internal,
            _ => DistributionProfile::Internal,
        }
    }
}

/// 当前有效发行档（debug 下可读 `YUNTUAI_DISTRIBUTION`）。
pub fn active_distribution_profile() -> DistributionProfile {
    let raw = resolve_distribution_profile_raw();
    if !RELAY_STATION_PRODUCT_ENABLED && raw == DistributionProfile::RelayStation {
        DistributionProfile::Internal
    } else {
        raw
    }
}

fn resolve_distribution_profile_raw() -> DistributionProfile {
    #[cfg(debug_assertions)]
    if let Ok(v) = std::env::var("YUNTUAI_DISTRIBUTION") {
        if !v.trim().is_empty() {
            return parse_profile_id(&v);
        }
    }
    compile_time_profile()
}

#[cfg(test)]
mod relay_gate_tests {
    use super::*;

    #[test]
    fn relay_station_product_enabled_for_customer_channel() {
        const { assert!(RELAY_STATION_PRODUCT_ENABLED) };
        // 未编译 relay-station 时，日常测试构建仍是内部版。
        assert_eq!(
            active_distribution_profile(),
            DistributionProfile::Internal
        );
    }
}

pub fn model_uses_relay_station(model: &str) -> bool {
    model.starts_with("yuntuai/") || model.starts_with("yuntuai:")
}

fn deepseek_provider_patch() -> Value {
    json!({
        "models": {
            "providers": {
                "deepseek": {
                    "baseUrl": "https://api.deepseek.com",
                    "apiKey": { "source": "env", "provider": "default", "id": "DEEPSEEK_API_KEY" },
                    "api": "openai-completions",
                    "timeoutSeconds": 7200,
                    "models": [
                        { "id": "deepseek-flash", "name": "DeepSeek V4.1 Flash", "contextWindow": 1048576, "maxTokens": 16384 },
                        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "contextWindow": 1048576, "maxTokens": 16384 },
                        { "id": "deepseek-v4-pro", "name": "DeepSeek V4 Pro", "contextWindow": 1048576, "maxTokens": 16384 }
                    ]
                }
            }
        }
    })
}

fn qwen_provider_patch() -> Value {
    json!({
        "models": {
            "providers": {
                "qwen": {
                    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "apiKey": { "source": "env", "provider": "default", "id": "DASHSCOPE_API_KEY" },
                    "api": "openai-completions",
                    "timeoutSeconds": 7200,
                    "models": [
                        { "id": "qwen3.6-flash", "name": "Qwen3.6 Flash", "contextWindow": 1048576, "maxTokens": 16384 },
                        { "id": "qwen3.6-plus", "name": "Qwen3.6 Plus", "contextWindow": 1048576, "maxTokens": 16384 },
                        { "id": "qwen3.7-plus", "name": "Qwen3.7 Plus", "contextWindow": 1048576, "maxTokens": 16384 },
                        { "id": "qwen3.7-max", "name": "Qwen3.7 Max", "contextWindow": 1048576, "maxTokens": 16384 }
                    ]
                }
            }
        }
    })
}

fn mimo_provider_patch() -> Value {
    json!({
        "models": {
            "providers": {
                "mimo": {
                    "baseUrl": "https://api.xiaomimimo.com/v1",
                    "apiKey": { "source": "env", "provider": "default", "id": "MIMO_API_KEY" },
                    "api": "openai-completions",
                    "timeoutSeconds": 7200,
                    "models": [
                        { "id": "mimo-v2.6-pro", "name": "MiMo V2.6 Pro", "contextWindow": 1048576, "maxTokens": 131072 },
                        { "id": "mimo-v2.6-flash", "name": "MiMo V2.6 Flash", "contextWindow": 1048576, "maxTokens": 32768 },
                        { "id": "mimo-v2.5-pro", "name": "MiMo V2.5 Pro", "contextWindow": 1048576, "maxTokens": 131072 },
                        { "id": "mimo-v2.5", "name": "MiMo V2.5", "contextWindow": 1048576, "maxTokens": 32768 }
                    ]
                }
            }
        }
    })
}

fn relay_provider_patch() -> Value {
    let models: Vec<Value> = RELAY_CATALOG
        .iter()
        .map(|(id, name, ctx)| {
            json!({
                "id": id,
                "name": name,
                "contextWindow": ctx,
                "maxTokens": 16384
            })
        })
        .collect();
    json!({
        "models": {
            "providers": {
                "yuntuai": {
                    "baseUrl": "https://api.doohuan.com/v1",
                    "apiKey": { "source": "env", "provider": "default", "id": "YUNTUAI_API_KEY" },
                    "api": "openai-completions",
                    "timeoutSeconds": 7200,
                    "models": models
                }
            }
        }
    })
}

pub fn profile_api_env_keys() -> &'static [(&'static str, bool)] {
    active_distribution_profile().api_env_keys()
}

pub fn seed_env_body(gateway_token: &str) -> String {
    let profile = active_distribution_profile();
    let key_id = profile.primary_api_env_key();
    let embedded = embedded_relay_api_key().unwrap_or("");
    let api_line = if !embedded.is_empty() {
        format!("{key_id}={embedded}\r\n")
    } else {
        format!("{key_id}=\r\n")
    };
    let dashscope_line = match profile {
        DistributionProfile::Internal => "DEEPSEEK_API_KEY=\r\nDASHSCOPE_API_KEY=\r\n",
        DistributionProfile::RelayStation => "",
    };
    format!(
        "# YunTuAI 自动生成 — 请勿提交到公开仓库\r\nOPENCLAW_GATEWAY_TOKEN={gateway_token}\r\n{api_line}{dashscope_line}"
    )
}

/// 若发行包内嵌 Key：中转站 locked 模式下强制与内嵌值对齐；否则仅在 .env 为空时补写。
pub fn ensure_embedded_api_key_in_env(env_map: &mut std::collections::HashMap<String, String>) -> bool {
    let Some(key) = embedded_relay_api_key() else {
        return false;
    };
    let id = active_distribution_profile().primary_api_env_key();
    let current = env_map.get(id).map(|s| s.trim()).unwrap_or("");
    if api_key_locked() {
        if current == key {
            return false;
        }
        env_map.insert(id.to_string(), key.to_string());
        return true;
    }
    if !current.is_empty() {
        return false;
    }
    env_map.insert(id.to_string(), key.to_string());
    true
}

pub fn seed_openclaw_json(workspace_path: &str) -> Value {
    let profile = active_distribution_profile();
    let primary = profile.primary_model();
    let models = match profile {
        DistributionProfile::Internal => deepseek_provider_patch()["models"].clone(),
        DistributionProfile::RelayStation => relay_provider_patch()["models"].clone(),
    };

    let mut seed = json!({
        "agents": {
            "defaults": {
                "workspace": workspace_path,
                "model": { "primary": primary },
                "sandbox": { "mode": "off" },
                "compaction": { "reserveTokensFloor": 32000 },
                "timeoutSeconds": 7200,
                "memorySearch": {
                    "enabled": true,
                    "provider": "local",
                    "fallback": "none"
                },
                "heartbeat": {
                    "every": "1h",
                    "target": "none",
                    "lightContext": true,
                    "isolatedSession": true,
                    "activeHours": {
                        "start": "08:00",
                        "end": "22:00"
                    }
                }
            },
            "list": [{ "id": "main", "model": primary }]
        },
        "gateway": {
            "mode": "local",
            "auth": { "mode": "token" },
            "port": 18789,
            "bind": "loopback",
            "controlUi": {
                "enabled": false,
                "allowInsecureAuth": true,
                "allowedOrigins": [
                    "http://tauri.localhost",
                    "https://tauri.localhost",
                    "tauri://localhost",
                    "http://localhost:1420",
                    "http://127.0.0.1:1420",
                    "http://localhost:1421",
                    "http://127.0.0.1:1421"
                ]
            }
        },
        "models": {
            "mode": "merge",
            "providers": models["providers"].clone()
        },
        "tools": { "profile": "full" },
        "plugins": {
            "entries": {
                "active-memory": {
                    "enabled": true,
                    "config": {
                        "enabled": true,
                        "agents": ["main"],
                        "allowedChatTypes": ["direct"],
                        "persistTranscripts": true,
                        "modelFallback": primary,
                        "timeoutMs": 20000
                    }
                },
                "memory-core": {
                    "enabled": true,
                    "config": {
                        "dreaming": { "enabled": true }
                    }
                }
            }
        },
        "skills": {
            "entries": {
                "coding-agent": { "enabled": false },
                "gemini": { "enabled": false },
                "github": { "enabled": false }
            }
        }
    });
    if let Some(image_model) = profile.default_image_model() {
        if let Some(obj) = seed.pointer_mut("/agents/defaults").and_then(|v| v.as_object_mut()) {
            obj.insert("imageModel".into(), json!(image_model));
        }
    }
    seed
}

fn env_key_configured(env_map: &HashMap<String, String>, key: &str) -> bool {
    env_map
        .get(key)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

fn ensure_provider_openai_completions(root: &mut Value, provider: &str, patch: Value) -> bool {
    let api = root
        .pointer(&format!("/models/providers/{provider}/api"))
        .and_then(|v| v.as_str());
    if api == Some("openai-completions") {
        return false;
    }
    deep_merge_json(root, patch);
    true
}

fn remove_models_provider(root: &mut Value, provider: &str) -> bool {
    root.pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
        .and_then(|p| p.remove(provider))
        .is_some()
}

/// 直连档：仅写入已配置 Key 的厂商，避免网关 SecretRef 指向空 Key 而启动失败。
fn sync_internal_models_providers(
    root: &mut Value,
    env_map: Option<&HashMap<String, String>>,
) -> bool {
    let mut changed = false;
    for (provider, env_key, patch) in [
        ("mimo", "MIMO_API_KEY", mimo_provider_patch()),
        ("deepseek", "DEEPSEEK_API_KEY", deepseek_provider_patch()),
        ("qwen", "DASHSCOPE_API_KEY", qwen_provider_patch()),
    ] {
        match env_map {
            Some(map) => {
                if env_key_configured(map, env_key) {
                    if ensure_provider_openai_completions(root, provider, patch) {
                        changed = true;
                    }
                } else if remove_models_provider(root, provider) {
                    changed = true;
                }
            }
            None => {
                if root
                    .pointer(&format!("/models/providers/{provider}"))
                    .is_some()
                    && ensure_provider_openai_completions(root, provider, patch)
                {
                    changed = true;
                }
            }
        }
    }
    changed
}

fn sync_internal_agent_provider_entries(
    providers: &mut Map<String, Value>,
    env_map: Option<&HashMap<String, String>>,
) -> bool {
    let mut changed = false;
    let provider_entry = |name: &str, patch: &Value| -> Value {
        patch["models"]["providers"][name].clone()
    };
    let ensure = |providers: &mut Map<String, Value>, name: &str, entry: Value| -> bool {
        match providers.get_mut(name) {
            Some(slot) => {
                if slot.get("api").and_then(|v| v.as_str()) == Some("openai-completions") {
                    return false;
                }
                deep_merge_json(slot, entry);
                true
            }
            None => {
                providers.insert(name.into(), entry);
                true
            }
        }
    };

    for (name, env_key, patch) in [
        ("mimo", "MIMO_API_KEY", mimo_provider_patch()),
        ("deepseek", "DEEPSEEK_API_KEY", deepseek_provider_patch()),
        ("qwen", "DASHSCOPE_API_KEY", qwen_provider_patch()),
    ] {
        let entry = provider_entry(name, &patch);
        match env_map {
            Some(map) => {
                if env_key_configured(map, env_key) {
                    if ensure(providers, name, entry) {
                        changed = true;
                    }
                } else if providers.remove(name).is_some() {
                    changed = true;
                }
            }
            None => {
                if providers.contains_key(name) && ensure(providers, name, entry) {
                    changed = true;
                }
            }
        }
    }
    changed
}

fn ensure_deepseek_flash_model(root: &mut Value) -> bool {
    let Some(arr) = root
        .pointer_mut("/models/providers/deepseek/models")
        .and_then(|v| v.as_array_mut())
    else {
        return false;
    };
    if arr
        .iter()
        .any(|m| m.get("id").and_then(|id| id.as_str()) == Some("deepseek-flash"))
    {
        return false;
    }
    arr.insert(
        0,
        json!({
            "id": "deepseek-flash",
            "name": "DeepSeek V4.1 Flash",
            "contextWindow": 1048576,
            "maxTokens": 16384
        }),
    );
    true
}

/// 按发行档修复 `openclaw.json` 的 models.providers。
/// `env_map` 为 `Some` 时按 `.env` 裁剪可选 provider（千问/DeepSeek 无 Key 则不写入）。
pub fn repair_openclaw_providers(
    root: &mut Value,
    env_map: Option<&HashMap<String, String>>,
) -> bool {
    let profile = active_distribution_profile();
    let mut changed = false;

    if let Some(providers) = root
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        match profile {
            DistributionProfile::Internal => {
                if providers.remove("yuntuai").is_some() {
                    changed = true;
                }
            }
            DistributionProfile::RelayStation => {
                if providers.remove("deepseek").is_some() {
                    changed = true;
                }
            }
        }
    }

    match profile {
        DistributionProfile::Internal => {
            if sync_internal_models_providers(root, env_map) {
                changed = true;
            }
            if ensure_deepseek_flash_model(root) {
                changed = true;
            }
            if crate::llm_user_providers::sync_user_llm_providers(root, env_map) {
                changed = true;
            }
        }
        DistributionProfile::RelayStation => {
            let patch = relay_provider_patch();
            let provider_key = "yuntuai";
            let api = root
                .pointer(&format!("/models/providers/{provider_key}/api"))
                .and_then(|v| v.as_str());
            let base_url = root
                .pointer(&format!("/models/providers/{provider_key}/baseUrl"))
                .and_then(|v| v.as_str());
            let expected_base = patch["models"]["providers"][provider_key]["baseUrl"]
                .as_str()
                .unwrap_or("");
            let api_key = root.pointer(&format!("/models/providers/{provider_key}/apiKey"));
            let expected_models = patch["models"]["providers"][provider_key]["models"].clone();
            let current_models = root
                .pointer(&format!("/models/providers/{provider_key}/models"))
                .cloned();
            let needs_merge = api != Some("openai-completions")
                || base_url != Some(expected_base)
                || api_key.is_none()
                || current_models.as_ref() != Some(&expected_models);
            if needs_merge {
                deep_merge_json(root, patch);
                if let Some(yt) = root
                    .pointer_mut(&format!("/models/providers/{provider_key}"))
                    .and_then(|v| v.as_object_mut())
                {
                    yt.insert("models".into(), expected_models);
                }
                changed = true;
            }
            if let Some(providers) = root
                .pointer_mut("/models/providers")
                .and_then(|v| v.as_object_mut())
            {
                let extra: Vec<String> = providers
                    .keys()
                    .filter(|k| k.as_str() != provider_key)
                    .cloned()
                    .collect();
                for key in extra {
                    providers.remove(&key);
                    changed = true;
                }
            }
        }
    }

    if let Some(providers) = root
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        if providers.remove("agnes").is_some() {
            changed = true;
        }
    }

    changed
}

/// 模型 provider 级超时（含 model idle timeout）与 Agent 2h 硬顶对齐。
pub fn repair_provider_timeout_seconds(root: &mut Value) -> bool {
    const PROVIDER_TIMEOUT: u64 = 7200;
    let provider_key = active_distribution_profile().provider_id();
    let path = format!("/models/providers/{provider_key}/timeoutSeconds");
    let current = root.pointer(&path).and_then(|v| v.as_u64()).unwrap_or(0);
    if current >= PROVIDER_TIMEOUT {
        return false;
    }
    let Some(providers) = root
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    else {
        return false;
    };
    let Some(provider) = providers.get_mut(provider_key).and_then(|v| v.as_object_mut()) else {
        return false;
    };
    provider.insert(
        "timeoutSeconds".into(),
        Value::Number(PROVIDER_TIMEOUT.into()),
    );
    true
}

fn configured_agent_ids(root: &Value) -> Vec<String> {
    root.get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        })
        .filter(|ids| !ids.is_empty())
        .unwrap_or_else(|| vec!["main".into()])
}

fn active_memory_agent_ids(root: &Value) -> Vec<String> {
    root.pointer("/plugins/entries/active-memory/config/agents")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn active_memory_needs_agent_repair(root: &Value) -> bool {
    let configured = configured_agent_ids(root);
    let current = active_memory_agent_ids(root);
    configured.iter().any(|id| !current.contains(id))
}

fn memory_plugins_allowlisted(root: &Value) -> bool {
    let Some(allow) = root.pointer("/plugins/allow").and_then(|v| v.as_array()) else {
        return true;
    };
    if allow.is_empty() {
        return true;
    }
    let names: Vec<&str> = allow.iter().filter_map(|v| v.as_str()).collect();
    names.contains(&"active-memory") && names.contains(&"memory-core")
}

/// 记忆检索与跨日接续：直连档默认用本机 embedding（无需 OpenAI Key）；启用 active-memory 与 dreaming。
pub fn repair_memory_recall_config(root: &mut Value) -> bool {
    let profile = active_distribution_profile();
    let primary = profile.primary_model();
    let mut changed = false;

    let current_provider = root
        .pointer("/agents/defaults/memorySearch/provider")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let needs_local_provider = matches!(profile, DistributionProfile::Internal)
        && (current_provider.is_empty()
            || current_provider == "openai"
            || current_provider == "auto");
    if needs_local_provider {
        deep_merge_json(
            root,
            json!({
                "agents": {
                    "defaults": {
                        "memorySearch": {
                            "enabled": true,
                            "provider": "local",
                            "fallback": "none"
                        }
                    }
                }
            }),
        );
        changed = true;
    }

    let memory_enabled = root
        .pointer("/agents/defaults/memorySearch/enabled")
        .and_then(|v| v.as_bool());
    if memory_enabled != Some(true) {
        deep_merge_json(
            root,
            json!({
                "agents": {
                    "defaults": {
                        "memorySearch": { "enabled": true }
                    }
                }
            }),
        );
        changed = true;
    }

    let active_enabled = root
        .pointer("/plugins/entries/active-memory/enabled")
        .and_then(|v| v.as_bool());
    let persist = root
        .pointer("/plugins/entries/active-memory/config/persistTranscripts")
        .and_then(|v| v.as_bool());
    if active_enabled != Some(true) || persist != Some(true) || active_memory_needs_agent_repair(root) {
        let agents = configured_agent_ids(root);
        deep_merge_json(
            root,
            json!({
                "plugins": {
                    "entries": {
                        "active-memory": {
                            "enabled": true,
                            "config": {
                                "enabled": true,
                                "agents": agents,
                                "allowedChatTypes": ["direct"],
                                "persistTranscripts": true,
                                "modelFallback": primary,
                                "timeoutMs": 20000
                            }
                        }
                    }
                }
            }),
        );
        changed = true;
    }

    let memory_core_enabled = root
        .pointer("/plugins/entries/memory-core/enabled")
        .and_then(|v| v.as_bool());
    let dreaming_enabled = root
        .pointer("/plugins/entries/memory-core/config/dreaming/enabled")
        .and_then(|v| v.as_bool());
    if memory_core_enabled != Some(true) || dreaming_enabled != Some(true) {
        deep_merge_json(
            root,
            json!({
                "plugins": {
                    "entries": {
                        "memory-core": {
                            "enabled": true,
                            "config": {
                                "dreaming": { "enabled": true }
                            }
                        }
                    }
                }
            }),
        );
        changed = true;
    }

    if !memory_plugins_allowlisted(root) {
        let mut allow = root
            .pointer("/plugins/allow")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for plugin in ["active-memory", "memory-core"] {
            if !allow.iter().any(|name| name == plugin) {
                allow.push(plugin.into());
            }
        }
        deep_merge_json(root, json!({ "plugins": { "allow": allow } }));
        changed = true;
    }

    changed
}

/// 注入 `agents.defaults.imageModel`（仅中转站且缺失时）。
pub fn repair_openclaw_image_model(root: &mut Value) -> bool {
    let Some(image_model) = active_distribution_profile().default_image_model() else {
        return false;
    };
    let current = root
        .pointer("/agents/defaults/imageModel")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if current.is_some() {
        return false;
    }
    if let Some(defaults) = root
        .pointer_mut("/agents/defaults")
        .and_then(|v| v.as_object_mut())
    {
        defaults.insert(
            "imageModel".into(),
            Value::String(image_model.to_string()),
        );
        return true;
    }
    false
}

fn is_valid_browser_profile_color(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() {
        return false;
    }
    if let Some(hex) = t.strip_prefix('#') {
        let len = hex.len();
        if len != 3 && len != 6 {
            return false;
        }
        return hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    const NAMED: &[&str] = &[
        "red", "blue", "green", "yellow", "orange", "purple", "pink", "cyan", "gray", "grey",
        "black", "white", "teal", "indigo", "violet", "amber", "lime", "emerald", "rose", "sky",
        "slate",
    ];
    let lower = t.to_lowercase();
    NAMED.contains(&lower.as_str())
}

/// 修复 `browser.profiles.*.color` 非法值（网关 strict schema 会导致 exit 1）。
pub fn repair_browser_profiles_in_config(root: &mut Value) -> bool {
    let Some(profiles) = root.pointer_mut("/browser/profiles") else {
        return false;
    };
    let Some(profiles_obj) = profiles.as_object_mut() else {
        return false;
    };

    let mut changed = false;
    let keys: Vec<String> = profiles_obj.keys().cloned().collect();
    for key in keys {
        let Some(profile) = profiles_obj.get_mut(&key) else {
            continue;
        };
        let Some(profile_obj) = profile.as_object_mut() else {
            continue;
        };
        if let Some(color_val) = profile_obj.get("color") {
            let invalid = match color_val {
                Value::String(s) => !is_valid_browser_profile_color(s),
                Value::Null => true,
                _ => true,
            };
            if invalid {
                profile_obj.remove("color");
                changed = true;
            }
        }
        if profile_obj.is_empty() {
            profiles_obj.remove(&key);
            changed = true;
        }
    }

    if profiles_obj.is_empty() {
        if let Some(browser) = root.get_mut("browser").and_then(|v| v.as_object_mut()) {
            browser.remove("profiles");
            if browser.is_empty() {
                if let Some(root_obj) = root.as_object_mut() {
                    root_obj.remove("browser");
                }
            }
        }
        changed = true;
    }
    changed
}

fn deep_merge_json(base: &mut Value, overlay: Value) {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            for (k, v) in overlay_map {
                match base_map.get_mut(&k) {
                    Some(existing) => deep_merge_json(existing, v),
                    None => {
                        base_map.insert(k, v);
                    }
                }
            }
        }
        (slot, overlay) => *slot = overlay,
    }
}

/// 修复 agent 级 `models.json`（merge 模式防污染）。
pub fn repair_agent_models_json(
    root: &mut Value,
    env_map: Option<&HashMap<String, String>>,
) -> bool {
    let profile = active_distribution_profile();
    let mut changed = false;
    let Some(providers) = root.pointer_mut("/providers").and_then(|v| v.as_object_mut()) else {
        return false;
    };

    match profile {
        DistributionProfile::Internal => {
            if providers.remove("yuntuai").is_some() {
                changed = true;
            }
            if sync_internal_agent_provider_entries(providers, env_map) {
                changed = true;
            }
        }
        DistributionProfile::RelayStation => {
            if providers.remove("deepseek").is_some() {
                changed = true;
            }
            let patch = relay_provider_patch()["models"]["providers"]["yuntuai"].clone();
            if let Some(yt) = providers.get_mut("yuntuai") {
                if yt.get("api").and_then(|v| v.as_str()) != Some("openai-completions") {
                    deep_merge_json(yt, patch.clone());
                    changed = true;
                }
            } else {
                providers.insert("yuntuai".into(), patch);
                changed = true;
            }
        }
    }

    changed
}

pub fn should_reset_primary_model(current: Option<&str>) -> bool {
    let profile = active_distribution_profile();
    match profile {
        DistributionProfile::Internal => {
            // 仅清掉缺失、过期直连模型和中转站残留；合法的 DeepSeek V4 / 千问主模型必须保留。
            matches!(
                current,
                None | Some("deepseek/deepseek-reasoner") | Some("deepseek/deepseek-chat")
            ) || current.is_some_and(model_uses_relay_station)
                || current.is_some_and(is_internal_misqualified_model)
        }
        DistributionProfile::RelayStation => {
            current.is_none()
                || current.is_some_and(|m| m.starts_with("deepseek/"))
                || current.is_some_and(|m| !model_uses_relay_station(m))
        }
    }
}

/// 内部版：MiMo 模型误挂在 deepseek provider，或仅有短 id 会被默认 provider 解析错。
fn is_internal_misqualified_model(model: &str) -> bool {
    let m = model.trim();
    if m.is_empty() {
        return false;
    }
    if m.to_ascii_lowercase().starts_with("deepseek/mimo") {
        return true;
    }
    if m == "mimo-v2.5" || m == "mimo-v2.5-pro" {
        return true;
    }
    false
}

#[allow(dead_code)]
pub fn primary_model_patch() -> Value {
    let primary = active_distribution_profile().primary_model();
    json!({ "agents": { "defaults": { "model": { "primary": primary } } } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repair_browser_profiles_removes_invalid_color() {
        let mut cfg = json!({
            "browser": { "profiles": { "user": { "color": "" } } }
        });
        assert!(repair_browser_profiles_in_config(&mut cfg));
        assert!(cfg.get("browser").is_none());
    }

    #[test]
    fn deepseek_seed_includes_deepseek_provider() {
        let j = seed_openclaw_json("/tmp/ws");
        assert!(j["models"]["providers"]["deepseek"].is_object());
        assert_eq!(
            j["models"]["providers"]["deepseek"]["baseUrl"],
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn qualify_model_id_routes_mimo() {
        assert_eq!(
            qualify_model_id("mimo-v2.5-pro"),
            "mimo/mimo-v2.5-pro"
        );
        assert_eq!(qualify_model_id("MiMo-V2.6-Pro"), "mimo/mimo-v2.6-pro");
        assert_eq!(
            qualify_model_id("deepseek/MiMo-V2.6-Pro"),
            "mimo/mimo-v2.6-pro"
        );
        assert_eq!(qualify_model_id("glm-4.7"), "zhipu/glm-4.7");
        assert_eq!(qualify_model_id("MiniMax-M2.5"), "minimax/MiniMax-M2.5");
        assert_eq!(
            qualify_model_id("kimi-k2.5"),
            "moonshot/kimi-k2.5"
        );
    }

    #[test]
    fn internal_seed_only_includes_required_deepseek_provider() {
        let j = seed_openclaw_json("/tmp/ws");
        assert!(j["models"]["providers"]["deepseek"].is_object());
        assert!(j["models"]["providers"].get("mimo").is_none());
        assert!(j["models"]["providers"].get("qwen").is_none());
        assert_eq!(
            j["agents"]["defaults"]["model"]["primary"],
            "deepseek/deepseek-flash"
        );
    }

    #[test]
    fn relay_seed_uses_yuntuai_provider() {
        // compile-time profile is deepseek in test; verify patch shape directly
        let patch = relay_provider_patch();
        assert_eq!(
            patch["models"]["providers"]["yuntuai"]["baseUrl"],
            "https://api.doohuan.com/v1"
        );
    }

    #[test]
    fn deepseek_direct_has_no_default_image_model() {
        assert_eq!(
            DistributionProfile::Internal.default_image_model(),
            None
        );
        assert_eq!(
            DistributionProfile::RelayStation.default_image_model(),
            Some("yuntuai/gpt-5.5")
        );
    }

    #[test]
    fn repair_deepseek_removes_yuntuai() {
        let mut cfg = json!({
            "models": {
                "providers": {
                    "yuntuai": { "baseUrl": "https://api.doohuan.com/v1" },
                    "deepseek": { "api": "legacy" }
                }
            }
        });
        let _ = repair_openclaw_providers(&mut cfg, None);
        assert!(cfg["models"]["providers"].get("yuntuai").is_none());
    }

    #[test]
    fn repair_memory_recall_from_disabled_template() {
        let mut cfg = json!({
            "agents": {
                "defaults": {
                    "memorySearch": { "enabled": false, "provider": "openai" }
                },
                "list": [{ "id": "main" }, { "id": "kb-assistant" }]
            },
            "plugins": {
                "allow": ["deepseek"],
                "entries": {
                    "active-memory": {
                        "enabled": false,
                        "config": { "agents": ["main"], "persistTranscripts": false }
                    },
                    "memory-core": { "enabled": false, "config": { "dreaming": { "enabled": false } } }
                }
            }
        });
        assert!(repair_memory_recall_config(&mut cfg));
        assert_eq!(cfg["agents"]["defaults"]["memorySearch"]["enabled"], true);
        assert_eq!(cfg["agents"]["defaults"]["memorySearch"]["provider"], "local");
        assert_eq!(cfg["plugins"]["entries"]["active-memory"]["enabled"], true);
        assert_eq!(
            cfg["plugins"]["entries"]["active-memory"]["config"]["persistTranscripts"],
            true
        );
        let agents = cfg["plugins"]["entries"]["active-memory"]["config"]["agents"]
            .as_array()
            .unwrap();
        assert!(agents.iter().any(|v| v == "main"));
        assert!(agents.iter().any(|v| v == "kb-assistant"));
        assert_eq!(cfg["plugins"]["entries"]["memory-core"]["enabled"], true);
        assert_eq!(
            cfg["plugins"]["entries"]["memory-core"]["config"]["dreaming"]["enabled"],
            true
        );
        let allow = cfg["plugins"]["allow"].as_array().unwrap();
        assert!(allow.iter().any(|v| v == "active-memory"));
        assert!(allow.iter().any(|v| v == "memory-core"));
    }

    #[test]
    fn repair_internal_prunes_qwen_without_dashscope_key() {
        let mut cfg = json!({
            "models": {
                "providers": {
                    "mimo": { "api": "openai-completions" },
                    "qwen": {
                        "api": "openai-completions",
                        "apiKey": { "id": "DASHSCOPE_API_KEY", "source": "env" }
                    }
                }
            }
        });
        let env = HashMap::from([("MIMO_API_KEY".into(), "sk-mimo".into())]);
        assert!(repair_openclaw_providers(&mut cfg, Some(&env)));
        assert!(cfg["models"]["providers"].get("qwen").is_none());
        assert!(cfg["models"]["providers"].get("mimo").is_some());
    }

    #[test]
    fn repair_internal_prunes_mimo_without_mimo_key() {
        let mut cfg = json!({
            "models": {
                "providers": {
                    "mimo": { "api": "openai-completions" },
                    "deepseek": { "api": "openai-completions" }
                }
            }
        });
        let env = HashMap::from([("DEEPSEEK_API_KEY".into(), "sk-ds".into())]);
        assert!(repair_openclaw_providers(&mut cfg, Some(&env)));
        assert!(cfg["models"]["providers"].get("mimo").is_none());
        assert!(cfg["models"]["providers"].get("deepseek").is_some());
    }

    #[test]
    fn repair_provider_timeout_bumps_low_value() {
        let mut cfg = json!({
            "models": {
                "providers": {
                    "deepseek": { "timeoutSeconds": 60 }
                }
            }
        });
        assert!(repair_provider_timeout_seconds(&mut cfg));
        assert_eq!(
            cfg["models"]["providers"]["deepseek"]["timeoutSeconds"].as_u64(),
            Some(7200)
        );
    }

    #[test]
    fn qualify_model_id_adds_provider_prefix() {
        assert_eq!(
            qualify_model_id("deepseek-v4-flash"),
            "deepseek/deepseek-v4-flash"
        );
        assert_eq!(qualify_model_id("deepseek/deepseek-chat"), "deepseek/deepseek-chat");
        assert_eq!(qualify_model_id(""), "deepseek/deepseek-flash");
    }

    #[test]
    fn short_model_id_strips_provider() {
        assert_eq!(short_model_id("yuntuai/gpt-5.5"), "gpt-5.5");
        assert_eq!(short_model_id("deepseek-chat"), "deepseek-chat");
    }

    #[test]
    fn deepseek_profile_resets_relay_primary() {
        // 编译档为 internal：中转站主模型应被重置
        assert!(should_reset_primary_model(Some("yuntuai/gpt-5.5")));
    }

    #[test]
    fn should_reset_deepseek_primary_on_relay_profile() {
        // compile profile is deepseek; verify relay logic via direct check pattern
        assert!(model_uses_relay_station("yuntuai/gpt-5.5"));
        assert!(!model_uses_relay_station("deepseek/deepseek-chat"));
    }

    #[test]
    fn should_reset_misqualified_mimo_on_internal_profile() {
        assert!(should_reset_primary_model(Some("deepseek/mimo-v2.5")));
        assert!(should_reset_primary_model(Some("mimo-v2.5")));
    }

    #[test]
    fn should_keep_direct_vendor_primaries() {
        assert!(!should_reset_primary_model(Some("deepseek/deepseek-flash")));
        assert!(!should_reset_primary_model(Some("deepseek/deepseek-v4-flash")));
        assert!(!should_reset_primary_model(Some("deepseek/deepseek-v4-pro")));
        assert!(!should_reset_primary_model(Some("qwen/qwen3.6-flash")));
        assert!(!should_reset_primary_model(Some("mimo/mimo-v2.5")));
        assert!(!should_reset_primary_model(Some("mimo/mimo-v2.6-pro")));
    }

    #[test]
    fn preferred_primary_follows_any_vendor_key() {
        let only_ds = HashMap::from([("DEEPSEEK_API_KEY".into(), "sk-ds".into())]);
        assert_eq!(
            preferred_primary_model_for_env_keys(&only_ds).as_deref(),
            Some("deepseek/deepseek-flash")
        );
        let only_qwen = HashMap::from([("DASHSCOPE_API_KEY".into(), "sk-q".into())]);
        assert_eq!(
            preferred_primary_model_for_env_keys(&only_qwen).as_deref(),
            Some("qwen/qwen3.6-flash")
        );
    }
}
