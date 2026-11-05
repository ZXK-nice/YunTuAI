import { getGatewayClient } from "./gateway-runtime";

/** 仅本机模式下建议禁用的外联/云端工具名（网关侧 best-effort denylist）。 */
export const LOCAL_ONLY_TOOL_DENY_PATTERNS = [
  "web_search",
  "web_fetch",
  "http",
  "fetch",
  "browser",
  "email",
  "smtp",
  "slack",
  "telegram",
  "discord",
  "sandbox",
  "cloud",
] as const;

/**
 * 发送前尝试通过 sessions.patch 写入工具限制（网关不支持时静默跳过）。
 * 与 agent-kernel 的 prompt 约束形成双保险。
 */
export async function patchSessionLocalOnlyForSend(sessionKey: string): Promise<void> {
  const key = sessionKey.trim();
  if (!key) return;
  const client = getGatewayClient();
  if (!client.isHelloOk) return;
  try {
    await client.request(
      "sessions.patch",
      {
        key,
        tools: {
          mode: "denylist",
          list: [...LOCAL_ONLY_TOOL_DENY_PATTERNS],
        },
      },
      { timeoutMs: 5_000 },
    );
  } catch {
    /* 旧版网关可能无 tools 字段，忽略 */
  }
}
