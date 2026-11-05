//! 自用版：国内厂商 + 自定义 OpenAI 兼容端点。
//! 用户自选厂商、填写模型名与 API Key；密钥写入 `.env`，槽位写入 `user-llm-providers.json`。

use crate::openclaw_runtime::strip_bom;
use crate::paths::openclaw_data_dir;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug)]
pub struct LlmPreset {
    pub id: &'static str,
    pub label: &'static str,
    pub env_key: &'static str,
    pub default_base_url: &'static str,
    pub example_model: &'static str,
    pub allows_custom_base_url: bool,
}

pub const LLM_PRESETS: &[LlmPreset] = &[
    LlmPreset {
        id: "zhipu",
        label: "智谱 GLM",
        env_key: "ZHIPU_API_KEY",
        default_base_url: "https://open.bigmodel.cn/api/paas/v4",
        example_model: "glm-4.5-flash",
        allows_custom_base_url: false,
    },
    LlmPreset {
        id: "moonshot",
        label: "月之暗面 Kimi",
        env_key: "MOONSHOT_API_KEY",
        default_base_url: "https://api.moonshot.cn/v1",
        example_model: "kimi-k2.5",
        allows_custom_base_url: false,
    },
    LlmPreset {
        id: "ark",
        label: "火山方舟 / 豆包",
        env_key: "ARK_API_KEY",
        default_base_url: "https://ark.cn-beijing.volces.com/api/v3",
        example_model: "doubao-seed-1.6",
        allows_custom_base_url: true,
    },
    LlmPreset {
        id: "siliconflow",
        label: "硅基流动",
        env_key: "SILICONFLOW_API_KEY",
        default_base_url: "https://api.siliconflow.cn/v1",
        example_model: "deepseek-ai/DeepSeek-V3.2",
        allows_custom_base_url: false,
    },
    LlmPreset {
        id: "minimax",
        label: "MiniMax",
        env_key: "MINIMAX_API_KEY",
        default_base_url: "https://api.minimax.chat/v1",
        example_model: "MiniMax-M2.5",
        allows_custom_base_url: false,
    },
    LlmPreset {
        id: "spark",
        label: "讯飞星火",
        env_key: "SPARK_API_KEY",
        default_base_url: "https://spark-api-open.xf-yun.com/v1",
        example_model: "generalv3.5",
        allows_custom_base_url: false,
    },
    LlmPreset {
        id: "custom",
        label: "自定义（OpenAI 兼容）",
        env_key: "CUSTOM_LLM_API_KEY",
        default_base_url: "https://api.example.com/v1",
        example_model: "your-model-id",
        allows_custom_base_url: true,
    },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserLlmSlot {
    pub id: String,
    #[serde(default)]
    pub base_url: String,
    pub model_id: String,
    #[serde(default)]
    pub model_name: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct UserLlmFile {
    #[serde(default)]
    slots: Vec<UserLlmSlot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPresetView {
    pub id: String,
    pub label: String,
    pub env_key: String,
    pub default_base_url: String,
    pub example_model: String,
    pub allows_custom_base_url: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserLlmSlotView {
    pub id: String,
    pub label: String,
    pub env_key: String,
    pub base_url: String,
    pub model_id: String,
    pub model_name: String,
    pub configured: bool,
    pub allows_custom_base_url: bool,
}

fn slots_path() -> Result<PathBuf, String> {
    Ok(openclaw_data_dir()?.join("user-llm-providers.json"))
}

pub fn preset_by_id(id: &str) -> Option<&'static LlmPreset> {
    LLM_PRESETS.iter().find(|p| p.id == id)
}

pub fn extra_api_env_keys() -> impl Iterator<Item = &'static str> {
    LLM_PRESETS.iter().map(|p| p.env_key)
}

fn read_slots_file() -> Vec<UserLlmSlot> {
    let Ok(path) = slots_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<UserLlmFile>(strip_bom(&raw))
        .map(|f| f.slots)
        .unwrap_or_default()
}

fn write_slots_file(slots: &[UserLlmSlot]) -> Result<(), String> {
    let path = slots_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&UserLlmFile {
        slots: slots.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    fs::write(path, format!("{body}\n")).map_err(|e| e.to_string())
}

pub fn list_presets() -> Vec<LlmPresetView> {
    LLM_PRESETS
        .iter()
        .map(|p| LlmPresetView {
            id: p.id.to_string(),
            label: p.label.to_string(),
            env_key: p.env_key.to_string(),
            default_base_url: p.default_base_url.to_string(),
            example_model: p.example_model.to_string(),
            allows_custom_base_url: p.allows_custom_base_url,
        })
        .collect()
}

pub fn list_slot_views(env_map: &HashMap<String, String>) -> Vec<UserLlmSlotView> {
    let slots = read_slots_file();
    LLM_PRESETS
        .iter()
        .map(|p| {
            let slot = slots.iter().find(|s| s.id == p.id);
            let configured = env_map
                .get(p.env_key)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false)
                && slot
                    .map(|s| !s.model_id.trim().is_empty())
                    .unwrap_or(false);
            UserLlmSlotView {
                id: p.id.to_string(),
                label: p.label.to_string(),
                env_key: p.env_key.to_string(),
                base_url: slot
                    .map(|s| s.base_url.clone())
                    .filter(|u| !u.trim().is_empty())
                    .unwrap_or_else(|| p.default_base_url.to_string()),
                model_id: slot.map(|s| s.model_id.clone()).unwrap_or_default(),
                model_name: slot.map(|s| s.model_name.clone()).unwrap_or_default(),
                configured,
                allows_custom_base_url: p.allows_custom_base_url,
            }
        })
        .collect()
}

pub fn any_extra_key_configured(env_map: &HashMap<String, String>) -> bool {
    extra_api_env_keys().any(|k| env_map.get(k).map(|v| !v.trim().is_empty()).unwrap_or(false))
}

pub fn provider_id_for_model(short: &str) -> Option<&'static str> {
    let short = short.trim();
    if short.is_empty() {
        return None;
    }
    for slot in read_slots_file() {
        if slot.model_id.trim() == short {
            if let Some(p) = preset_by_id(&slot.id) {
                return Some(p.id);
            }
        }
    }
    let lower = short.to_ascii_lowercase();
    if lower.starts_with("glm") {
        return Some("zhipu");
    }
    if lower.starts_with("kimi") || lower.starts_with("moonshot") {
        return Some("moonshot");
    }
    if lower.starts_with("doubao") || lower.starts_with("ep-") {
        return Some("ark");
    }
    if lower.starts_with("minimax") || lower.starts_with("abab") {
        return Some("minimax");
    }
    if lower.starts_with("generalv") || lower.starts_with("spark") {
        return Some("spark");
    }
    None
}

pub fn preferred_extra_model(env_map: &HashMap<String, String>) -> Option<String> {
    for slot in list_slot_views(env_map) {
        if slot.configured {
            return Some(format!("{}/{}", slot.id, slot.model_id.trim()));
        }
    }
    None
}

pub fn extra_available_models(env_map: &HashMap<String, String>) -> Vec<(String, String)> {
    list_slot_views(env_map)
        .into_iter()
        .filter(|s| s.configured)
        .map(|s| {
            let label = if s.model_name.trim().is_empty() {
                format!("{} · {}", s.label, s.model_id)
            } else {
                format!("{} · {}", s.label, s.model_name)
            };
            (s.model_id, label)
        })
        .collect()
}

fn openai_provider_patch(id: &str, base_url: &str, env_key: &str, model_id: &str, model_name: &str) -> Value {
    json!({
        "models": {
            "providers": {
                id: {
                    "baseUrl": base_url,
                    "apiKey": { "source": "env", "provider": "default", "id": env_key },
                    "api": "openai-completions",
                    "timeoutSeconds": 7200,
                    "models": [
                        {
                            "id": model_id,
                            "name": model_name,
                            "contextWindow": 131072,
                            "maxTokens": 16384
                        }
                    ]
                }
            }
        }
    })
}

fn upsert_provider(root: &mut Value, patch: Value, provider: &str) -> bool {
    let expected = patch["models"]["providers"][provider].clone();
    let current = root.pointer(&format!("/models/providers/{provider}")).cloned();
    if current.as_ref() == Some(&expected) {
        return false;
    }
    if root.pointer("/models/providers").is_none() {
        if let Some(obj) = root.as_object_mut() {
            obj.insert("models".into(), json!({ "providers": {} }));
        }
    }
    if let Some(providers) = root
        .pointer_mut("/models/providers")
        .and_then(|v| v.as_object_mut())
    {
        providers.insert(provider.to_string(), expected);
        return true;
    }
    if let Some(obj) = root.as_object_mut() {
        let mut providers = Map::new();
        providers.insert(provider.to_string(), expected);
        obj.insert("models".into(), json!({ "providers": providers }));
        return true;
    }
    false
}

/// 按已保存槽位写入 / 裁剪 OpenClaw providers。
pub fn sync_user_llm_providers(
    root: &mut Value,
    env_map: Option<&HashMap<String, String>>,
) -> bool {
    let Some(map) = env_map else {
        return false;
    };
    let slots = read_slots_file();
    let mut changed = false;
    for preset in LLM_PRESETS {
        let key_ok = map
            .get(preset.env_key)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let slot = slots.iter().find(|s| s.id == preset.id);
        let model_id = slot.map(|s| s.model_id.trim()).unwrap_or("");
        if key_ok && !model_id.is_empty() {
            let base = slot
                .map(|s| s.base_url.trim())
                .filter(|u| !u.is_empty())
                .unwrap_or(preset.default_base_url);
            let name = slot
                .map(|s| s.model_name.trim())
                .filter(|n| !n.is_empty())
                .unwrap_or(model_id);
            let patch = openai_provider_patch(preset.id, base, preset.env_key, model_id, name);
            if upsert_provider(root, patch, preset.id) {
                changed = true;
            }
        } else if root
            .pointer_mut("/models/providers")
            .and_then(|v| v.as_object_mut())
            .and_then(|p| p.remove(preset.id))
            .is_some()
        {
            changed = true;
        }
    }
    changed
}

pub fn save_slot(
    id: String,
    api_key: String,
    model_id: String,
    model_name: String,
    base_url: String,
) -> Result<Vec<UserLlmSlotView>, String> {
    if crate::distribution_policy::api_key_locked() {
        return Err("中转站版本不能自行添加模型或厂商密钥，请在对话里选择已上架模型。".into());
    }
    let preset = preset_by_id(id.trim()).ok_or_else(|| "不支持的厂商".to_string())?;
    let model_id = model_id.trim().to_string();
    if model_id.is_empty() {
        return Err("请填写模型名称（控制台里的 Model ID）".into());
    }
    if model_id.len() > 128 {
        return Err("模型名称过长".into());
    }
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("请填写 API Key".into());
    }
    if api_key.len() > 512 {
        return Err("API Key 过长".into());
    }
    let mut base = base_url.trim().to_string();
    if base.is_empty() {
        base = preset.default_base_url.to_string();
    }
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err("接口地址须以 http:// 或 https:// 开头".into());
    }
    if base.len() > 256 {
        return Err("接口地址过长".into());
    }

    let mut slots = read_slots_file();
    let next = UserLlmSlot {
        id: preset.id.to_string(),
        base_url: base,
        model_id,
        model_name: model_name.trim().to_string(),
    };
    if let Some(existing) = slots.iter_mut().find(|s| s.id == preset.id) {
        *existing = next;
    } else {
        slots.push(next);
    }
    write_slots_file(&slots)?;

    let mut env = HashMap::new();
    env.insert(preset.env_key.to_string(), api_key);
    crate::openclaw_env::write_managed_env_values(&env)?;
    let _ = crate::openclaw_control::sync_model_providers_for_dotenv();
    let env_map = crate::openclaw_env::read_managed_env_map().unwrap_or_default();
    Ok(list_slot_views(&env_map))
}

pub fn clear_slot(id: String) -> Result<Vec<UserLlmSlotView>, String> {
    let preset = preset_by_id(id.trim()).ok_or_else(|| "不支持的厂商".to_string())?;
    let slots: Vec<_> = read_slots_file()
        .into_iter()
        .filter(|s| s.id != preset.id)
        .collect();
    write_slots_file(&slots)?;
    let mut env = HashMap::new();
    env.insert(preset.env_key.to_string(), String::new());
    crate::openclaw_env::write_managed_env_values(&env)?;
    let _ = crate::openclaw_control::sync_model_providers_for_dotenv();
    let env_map = crate::openclaw_env::read_managed_env_map().unwrap_or_default();
    Ok(list_slot_views(&env_map))
}

#[tauri::command]
pub async fn llm_user_list_presets() -> Result<Vec<LlmPresetView>, String> {
    crate::ipc::run_blocking(|| Ok(list_presets())).await
}

#[tauri::command]
pub async fn llm_user_list_slots(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
) -> Result<Vec<UserLlmSlotView>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        let env_map = crate::openclaw_env::read_managed_env_map().unwrap_or_default();
        Ok(list_slot_views(&env_map))
    })
    .await
}

#[tauri::command]
pub async fn llm_user_save_slot(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
    id: String,
    api_key: String,
    model_id: String,
    model_name: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<UserLlmSlotView>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        save_slot(
            id,
            api_key,
            model_id,
            model_name.unwrap_or_default(),
            base_url.unwrap_or_default(),
        )
    })
    .await
}

#[tauri::command]
pub async fn llm_user_clear_slot(
    state: tauri::State<'_, crate::db::DbState>,
    token: String,
    id: String,
) -> Result<Vec<UserLlmSlotView>, String> {
    let conn = state.conn.clone();
    crate::ipc::run_blocking(move || {
        crate::auth::assert_authenticated_mutex(&conn, &token)?;
        clear_slot(id)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_cover_domestic_and_custom() {
        let ids: Vec<_> = LLM_PRESETS.iter().map(|p| p.id).collect();
        assert!(ids.contains(&"zhipu"));
        assert!(ids.contains(&"moonshot"));
        assert!(ids.contains(&"ark"));
        assert!(ids.contains(&"custom"));
        assert!(!ids.contains(&"yi"));
    }

    #[test]
    fn glm_prefix_maps_to_zhipu() {
        assert_eq!(provider_id_for_model("glm-4.7"), Some("zhipu"));
        assert_eq!(provider_id_for_model("kimi-k2.5"), Some("moonshot"));
    }
}
