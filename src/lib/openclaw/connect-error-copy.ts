import { sanitizeUserFacingCopy } from "../product-copy";

/** 将网关/连接底层错误转为用户可读说明（启动门闸、顶栏状态共用）。 */
export function humanizeConnectError(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;

  if (/api\s*key|MIMO_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY|missing.*key|未配置.*key/i.test(t)) {
    return "尚未配置 API Key。请在「软件设置 → 模型密钥」填写 MiMo / DeepSeek / 千问任意一家后重试。";
  }
  if (/127\.0\.0\.1|18789|localhost|回环|loopback/i.test(t) && /refused|timeout|无法|失败|unreachable/i.test(t)) {
    return "本机服务未就绪或被安全软件拦截。请稍等自动重连，或点「重试」；仍失败可「先进入界面」查看历史记录，并在设置中检查本机服务。";
  }
  if (/establish|exclusive|stop_all|占用|冲突|external/i.test(t)) {
    return "检测到其他本机服务进程占用端口。软件正在回收控制权；若长时间无进展，可在设置 → 本机服务中「回收控制权」后重试。";
  }
  if (/token|auth|unauthorized|401|403/i.test(t)) {
    return "本机服务认证失败。请在「软件设置 → 本机服务」核对连接配置，或尝试「回收控制权」后重连。";
  }
  if (/timeout|timed out|超时/i.test(t)) {
    return "连接超时。冷启动或首次解压可能需要 1～3 分钟；可点「先进入界面」离线查看历史，后台仍会自动重连。";
  }
  if (/ENOENT|not found|找不到|missing.*tesseract|openclaw/i.test(t)) {
    return "内置运行时文件不完整。请尝试在设置中「修复本机服务」或重新安装最新版安装包。";
  }

  const sanitized = sanitizeUserFacingCopy(t);
  if (sanitized.length > 180) {
    return `${sanitized.slice(0, 177)}…`;
  }
  return sanitized;
}
