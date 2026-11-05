//! Relay API (api.doohuan.com) WAF blocks OpenAI SDK default `User-Agent` (`OpenAI/...`).
//! Patch bundled OpenClaw dist chunks to send `YunTuAI/<version>` instead.

use std::fs;
use std::path::{Path, PathBuf};

const PATCH_MARKER: &str = "defaultHeaders[\"User-Agent\"]";

fn relay_user_agent() -> String {
    format!("YunTuAI/{}", env!("CARGO_PKG_VERSION"))
}

fn openclaw_dist_dir(npm_prefix: &Path) -> PathBuf {
    npm_prefix.join("node_modules").join("openclaw").join("dist")
}

fn patch_create_client_file(content: &str, user_agent: &str) -> Option<String> {
    if content.contains(PATCH_MARKER) {
        return None;
    }
    let needle = "\t} : headers;\r\n\treturn new OpenAI({";
    let replacement = format!(
        "\t}} : headers;\r\n\tdefaultHeaders[\"User-Agent\"] = \"{user_agent}\";\r\n\treturn new OpenAI({{"
    );
    if content.contains(needle) {
        return Some(content.replace(needle, &replacement));
    }
    let needle = "\t} : headers;\n\treturn new OpenAI({";
    let replacement = format!(
        "\t}} : headers;\n\tdefaultHeaders[\"User-Agent\"] = \"{user_agent}\";\n\treturn new OpenAI({{"
    );
    if content.contains(needle) {
        return Some(content.replace(needle, &replacement));
    }
    None
}

fn patch_transport_stream_file(content: &str, user_agent: &str) -> Option<String> {
    if content.contains("result[\"User-Agent\"]") {
        return None;
    }
    let old = "\treturn resolveProviderRequestPolicyConfig({\r\n\t\tprovider: model.provider,\r\n\t\tapi: model.api,\r\n\t\tbaseUrl: model.baseUrl,\r\n\t\tcapability: \"llm\",\r\n\t\ttransport: \"stream\",\r\n\t\tproviderHeaders,\r\n\t\tcallerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : void 0,\r\n\t\tprecedence: \"caller-wins\"\r\n\t}).headers ?? {};";
    let new = format!(
        "\tconst result = resolveProviderRequestPolicyConfig({{\r\n\t\tprovider: model.provider,\r\n\t\tapi: model.api,\r\n\t\tbaseUrl: model.baseUrl,\r\n\t\tcapability: \"llm\",\r\n\t\ttransport: \"stream\",\r\n\t\tproviderHeaders,\r\n\t\tcallerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : void 0,\r\n\t\tprecedence: \"caller-wins\"\r\n\t}}).headers ?? {{}};\r\n\tresult[\"User-Agent\"] = \"{user_agent}\";\r\n\treturn result;"
    );
    if content.contains(old) {
        return Some(content.replace(old, &new));
    }
    let old = "\treturn resolveProviderRequestPolicyConfig({\n\t\tprovider: model.provider,\n\t\tapi: model.api,\n\t\tbaseUrl: model.baseUrl,\n\t\tcapability: \"llm\",\n\t\ttransport: \"stream\",\n\t\tproviderHeaders,\n\t\tcallerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : void 0,\n\t\tprecedence: \"caller-wins\"\n\t}).headers ?? {};";
    let new = format!(
        "\tconst result = resolveProviderRequestPolicyConfig({{\n\t\tprovider: model.provider,\n\t\tapi: model.api,\n\t\tbaseUrl: model.baseUrl,\n\t\tcapability: \"llm\",\n\t\ttransport: \"stream\",\n\t\tproviderHeaders,\n\t\tcallerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : void 0,\n\t\tprecedence: \"caller-wins\"\n\t}}).headers ?? {{}};\n\tresult[\"User-Agent\"] = \"{user_agent}\";\n\treturn result;"
    );
    if content.contains(old) {
        return Some(content.replace(old, &new));
    }
    None
}

fn patch_dist_file(path: &Path, user_agent: &str) -> Result<bool, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let raw = fs::read_to_string(path).map_err(|e| format!("读取 {:?}: {e}", path))?;
    let updated = if name.starts_with("openai-completions-") || name.starts_with("openai-responses-")
    {
        patch_create_client_file(&raw, user_agent)
    } else if name.starts_with("openai-transport-stream-") {
        patch_transport_stream_file(&raw, user_agent)
    } else {
        None
    };
    if let Some(next) = updated {
        fs::write(path, next).map_err(|e| format!("写入 {:?}: {e}", path))?;
        return Ok(true);
    }
    Ok(false)
}

/// Idempotent: patch OpenClaw dist under `npm-prefix` for relay WAF compatibility.
pub fn patch_openclaw_npm_prefix_for_relay_waf(npm_prefix: &Path) -> Result<usize, String> {
    let dist = openclaw_dist_dir(npm_prefix);
    if !dist.is_dir() {
        return Ok(0);
    }
    let user_agent = relay_user_agent();
    let mut patched = 0usize;
    let entries = fs::read_dir(&dist).map_err(|e| format!("读取 OpenClaw dist: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if patch_dist_file(&path, &user_agent)? {
            patched += 1;
            eprintln!(
                "[YunTuAI] relay WAF patch applied: {:?} (User-Agent: {})",
                path.file_name().unwrap_or_default(),
                user_agent
            );
        }
    }
    Ok(patched)
}

pub fn portable_npm_prefix() -> Result<PathBuf, String> {
    Ok(crate::paths::installed_dir()?
        .join("openclaw-portable")
        .join("npm-prefix"))
}

/// Apply relay WAF patch to the installed portable OpenClaw bundle (no-op if missing).
pub fn ensure_portable_relay_waf_patch() -> Result<usize, String> {
    let prefix = portable_npm_prefix()?;
    patch_openclaw_npm_prefix_for_relay_waf(&prefix)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_create_client_chunk() {
        let sample = r#"	const defaultHeaders = model.provider === "cloudflare-ai-gateway" ? {
		...headers,
		Authorization: headers.Authorization ?? null,
		"cf-aig-authorization": `Bearer ${apiKey}`
	} : headers;
	return new OpenAI({
		apiKey,
"#;
        let out = patch_create_client_file(sample, "YunTuAI/1.3.5").expect("patched");
        assert!(out.contains(r#"defaultHeaders["User-Agent"] = "YunTuAI/1.3.5""#));
        assert!(patch_create_client_file(&out, "YunTuAI/1.3.5").is_none());
    }

    #[test]
    fn patches_transport_stream_chunk() {
        let sample = r#"function buildOpenAIClientHeaders(model, context, optionHeaders, turnHeaders) {
	return resolveProviderRequestPolicyConfig({
		provider: model.provider,
		api: model.api,
		baseUrl: model.baseUrl,
		capability: "llm",
		transport: "stream",
		providerHeaders,
		callerHeaders: Object.keys(callerHeaders).length > 0 ? callerHeaders : void 0,
		precedence: "caller-wins"
	}).headers ?? {};
}
"#;
        let out = patch_transport_stream_file(sample, "YunTuAI/1.3.5").expect("patched");
        assert!(out.contains("const result = resolveProviderRequestPolicyConfig"));
        assert!(out.contains(r#"result["User-Agent"] = "YunTuAI/1.3.5""#));
        assert!(patch_transport_stream_file(&out, "YunTuAI/1.3.5").is_none());
    }
}
