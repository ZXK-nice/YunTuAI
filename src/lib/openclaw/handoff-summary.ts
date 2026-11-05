import type { LocalMessageRow } from "../../stores/sessionStore";
import { getGatewayClient } from "./gateway-runtime";
import { gatewayCreateRemoteSession } from "../../stores/gatewayStore";
import { buildSessionsSendParams } from "./session-rpc";
import { fetchAssistantBaseline, pollForNewAssistantAfterSend } from "./chat-history-sync";
import { gatewaySessionDelete } from "./console-control";

const HANDOFF_INPUT_MAX_MESSAGES = 8;
const HANDOFF_INPUT_MAX_CHARS_PER_MESSAGE = 800;
const HANDOFF_INPUT_TOTAL_CHARS = 6_500;
const HANDOFF_OUTPUT_MAX_CHARS = 1_200;
const HANDOFF_SEND_TIMEOUT_MS = 240_000;
const HANDOFF_POLL_TIMEOUT_MS = 200_000;

function clipForSummary(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** 供 LLM 摘要的输入（最后若干条、限长、限制总字符，控制摘要成本）。 */
export function buildSummaryInput(messages: LocalMessageRow[]): string {
  const recent = messages.slice(-HANDOFF_INPUT_MAX_MESSAGES);
  const lines: string[] = [];
  let total = 0;
  for (const m of recent) {
    if (m.role === "system") continue;
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "系统";
    const body = clipForSummary(m.content, HANDOFF_INPUT_MAX_CHARS_PER_MESSAGE);
    if (!body) continue;
    const line = `${role}：${body}`;
    if (total + line.length > HANDOFF_INPUT_TOTAL_CHARS) break;
    lines.push(line);
    total += line.length;
  }
  return lines.join("\n");
}

const HANDOFF_SUMMARY_PROMPT = `你是云图AI的对话摘要助手。请把下面这段对话压缩为 3～6 条要点，要求：
1. 保留未完成事项、用户明确偏好、已产出的文件路径、需要继续处理的内容；
2. 每条不超过 80 字，先写结论再写依据；
3. 只输出要点列表（用「- 」开头），不要任何解释、寒暄或标题。

【对话内容】
`;

/** 摘要并新建：先尝试用模型生成更短的接续摘要（独立临时会话，不占用当前会话）。 */
export async function generateLlmHandoffSummary(
  messages: LocalMessageRow[],
): Promise<string | null> {
  const input = buildSummaryInput(messages);
  if (!input.trim()) return null;

  const client = getGatewayClient();
  let remoteKey: string | undefined;
  try {
    const localId = crypto.randomUUID();
    remoteKey = await gatewayCreateRemoteSession(
      `云图对话摘要 · ${new Date().toLocaleTimeString()}`,
      localId,
    );
    if (!remoteKey) return null;

    const baseline = await fetchAssistantBaseline((m, p) => client.request(m, p), remoteKey);
    const params = buildSessionsSendParams(remoteKey, HANDOFF_SUMMARY_PROMPT + input, {
      timeoutMs: HANDOFF_SEND_TIMEOUT_MS,
      idempotencyKey: crypto.randomUUID(),
    });
    await client.request("sessions.send", params);
    const reply = await pollForNewAssistantAfterSend(
      (m, p) => client.request(m, p),
      remoteKey,
      baseline,
      { timeoutMs: HANDOFF_POLL_TIMEOUT_MS },
    );
    const text = typeof reply === "string" ? reply.trim() : "";
    if (!text) return null;
    return text.length > HANDOFF_OUTPUT_MAX_CHARS
      ? `${text.slice(0, HANDOFF_OUTPUT_MAX_CHARS - 1)}…`
      : text;
  } catch {
    return null;
  } finally {
    // 摘要会话是一次性的，用完即删，避免网关侧会话堆积
    if (remoteKey) {
      gatewaySessionDelete(remoteKey).catch(() => undefined);
    }
  }
}
