/**
 * 技能工坊 AI 生成专用隔离会话，避免污染用户主聊天历史。
 */
import { getGatewayClient } from "../openclaw/gateway-runtime";
import { extractSessionKey } from "../openclaw/session-rpc";
import {
  fetchAssistantBaseline,
  pollForNewAssistantAfterSend,
} from "../openclaw/chat-history-sync";
import { PRODUCT_NAME } from "../product-brand";

const STUDIO_LABEL_PREFIX = `${PRODUCT_NAME}·技能工坊`;

export async function ensureSkillStudioEphemeralSession(): Promise<string | null> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return null;

  const label = `${STUDIO_LABEL_PREFIX} · ${Date.now().toString(36)}`;
  try {
    const raw = await client.request<unknown>("sessions.create", { label }, { timeoutMs: 60_000 });
    return extractSessionKey(raw) ?? extractSessionKey((raw as { result?: unknown })?.result) ?? null;
  } catch {
    return null;
  }
}

export async function sendSkillStudioPromptAndPoll(
  sessionKey: string,
  prompt: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<string | null> {
  const client = getGatewayClient();
  const request = (method: string, params: Record<string, unknown>) =>
    client.request(method, params, { timeoutMs: 180_000 });

  const baseline = await fetchAssistantBaseline(request, sessionKey);
  await request("sessions.send", {
    sessionKey,
    message: prompt,
    idempotencyKey: `skill-studio-${Date.now()}`,
  });

  const reply = await pollForNewAssistantAfterSend(request, sessionKey, baseline, {
    timeoutMs: opts?.timeoutMs ?? 120_000,
    signal: opts?.signal,
    preferWs: true,
  });

  if (!reply || reply === "aborted" || reply.startsWith("[错误]")) return null;
  return reply;
}
