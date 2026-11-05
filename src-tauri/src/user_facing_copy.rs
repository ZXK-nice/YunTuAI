//! 用户可见错误/提示文案：剥离第三方运行时品牌与技术路径名。

/// 将后端/网关原文转为用户友好中文（不含 openclaw 等品牌词）。
pub fn sanitize_user_facing_copy(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let mut out = text.to_string();
    const REPLACEMENTS: &[(&str, &str)] = &[
        ("OPENCLAW_GATEWAY_TOKEN", "服务令牌"),
        ("OPENCLAW_GATEWAY_PORT", "本机服务端口"),
        ("OPENCLAW_GATEWAY_HOST", "本机服务主机"),
        ("npm install openclaw", "npm install 本机服务组件"),
        ("openclaw.mjs", "服务入口脚本"),
        ("openclaw.cmd", "服务启动脚本"),
        ("openclaw-portable-payload.zip", "内置运行时安装包"),
        ("openclaw-portable", "内置运行时"),
        ("openclaw-bundled", "内置"),
        ("openclaw.json", "服务配置文件"),
        ("openclaw-data", "服务数据目录"),
        ("~/.openclaw", "旧版用户目录"),
        (".openclaw", "旧版用户目录"),
        ("openclawVersion", "服务版本"),
        ("OpenClaw", "本机服务"),
        ("Open Claw", "本机服务"),
        ("openclaw", "本机服务"),
        ("小龙虾", "本机服务"),
        ("Run \"openclaw doctor --fix\"", "请使用软件内「修复服务配置」"),
        ("openclaw doctor --fix", "修复服务配置"),
        ("Gateway failed to start", "本机服务启动失败"),
        ("stability bundle", "诊断包"),
    ];
    for (from, to) in REPLACEMENTS {
        if out.contains(from) {
            out = out.replace(from, to);
        }
    }
    // 环境变量兜底
    while let Some(start) = out.find("OPENCLAW_") {
        let end = out[start..]
            .find(|c: char| !c.is_ascii_uppercase() && c != '_')
            .map(|i| start + i)
            .unwrap_or(out.len());
        out.replace_range(start..end, "服务环境变量");
    }
    if out.contains("本机网关") {
        out = out.replace("本机网关", "本机服务");
    }
    if out.contains("外部网关") {
        out = out.replace("外部网关", "外部服务");
    }
    if out.contains("网关") {
        out = out.replace("网关", "本机服务");
    }
    while out.contains("本机服务本机服务") {
        out = out.replace("本机服务本机服务", "本机服务");
    }
    out
}

/// 网关启动失败：按 stderr 生成可操作的中文提示（不含品牌词）。
pub fn humanize_gateway_startup_error(stderr: &str, exit_code: Option<i32>) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("invalid config") {
        if lower.contains("browser.profiles") && lower.contains("color") {
            return "服务配置文件中的浏览器颜色设置不合法，本机服务无法启动。软件将尝试自动修复；若仍失败，请到「软件设置 → 本机服务」点击「修复服务配置」。".into();
        }
        return "服务配置文件格式校验未通过，本机服务无法启动。请到「软件设置 → 本机服务」点击「修复服务配置」后重试。".into();
    }
    if lower.contains("api key") || lower.contains("api_key") || lower.contains("deepseek_api_key") {
        if lower.contains("dashscope_api_key") {
            return "千问 API Key 未配置，但服务配置中仍引用了千问。请到「软件设置 → API 接入」填写千问 Key，或保存已有厂商 Key 后重启以自动裁剪未配置的模型。".into();
        }
        return "模型 API Key 未配置或无效，本机服务无法启动。请到「软件设置 → 本机服务」填写密钥后重试。".into();
    }
    if lower.contains("device not licensed") || lower.contains("license") {
        return "设备未授权或授权已过期，请先完成设备授权。".into();
    }
    if let Some(code) = exit_code {
        if stderr.trim().is_empty() {
            return format!("本机服务启动后退出（代码 {code}）。请到「软件设置 → 本机服务」查看连接状态或点击「修复服务配置」。");
        }
    }
    let cleaned = sanitize_user_facing_copy(stderr);
    if cleaned.len() > 400 {
        format!(
            "本机服务启动失败：{}…",
            cleaned.chars().take(400).collect::<String>()
        )
    } else if cleaned.trim().is_empty() {
        "本机服务启动失败。请到「软件设置 → 本机服务」重试或点击「修复服务配置」。".into()
    } else {
        format!("本机服务启动失败：{cleaned}")
    }
}

/// 监管状态文案是否表示「已尝试启动但失败」（区别于单纯的「未运行」）。
pub fn looks_like_actionable_gateway_startup_failure(message: &str) -> bool {
    let m = message.trim();
    if m.is_empty() {
        return false;
    }
    if m == "本机服务未在 YunTu Control 监管下运行" || m == "网关未在 YunTu Control 监管下运行" {
        return false;
    }
    let lower = m.to_lowercase();
    lower.contains("无法启动")
        || lower.contains("api key")
        || lower.contains("api_key")
        || lower.contains("密钥")
        || lower.contains("未配置")
        || lower.contains("invalid config")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_openclaw_from_paths() {
        let raw = "Invalid config at D:\\yuntu\\openclaw-data\\openclaw.json. browser.profiles.user.color";
        let out = sanitize_user_facing_copy(raw);
        assert!(!out.to_lowercase().contains("openclaw"));
        assert!(out.contains("服务数据目录"));
        assert!(out.contains("服务配置文件"));
    }

    #[test]
    fn humanize_browser_color_error() {
        let stderr = "Gateway failed to start: Invalid config at D:\\yuntu\\openclaw-data\\openclaw.json. browser.profiles.user.color: Invalid input";
        let msg = humanize_gateway_startup_error(stderr, Some(1));
        assert!(!msg.to_lowercase().contains("openclaw"));
        assert!(msg.contains("浏览器颜色"));
    }
}
