/**
 * 长任务中断时，将仍在内存中的流式草稿落库，避免用户已看到的输出丢失。
 */

import {
  ASSISTANT_REPLY_TIMEOUT_NOTICE,
  ASSISTANT_SEND_HARD_CAP_NOTICE,
  ASSISTANT_STOPPED_NOTICE,
} from "../openclaw/send-wait";
import type { LocalMessageRow } from "../../stores/sessionStore";
import { isDeliveredAssistantContent as isDeliverableAssistantBody } from "./deliverable-content";
import { upsertTurnAssistantMessage } from "./upsert-turn-assistant-message";

export function isDeliveredAssistantContent(content: string): boolean {
  return isDeliveredAssistantContentForSend(content);
}

export const STREAMING_DRAFT_INTERRUPTED_SUFFIX =
  "\n\n---\n【生成已中断，以上为已输出内容。发送「继续」可从断点续写。】";

const SYSTEM_NOTICES = new Set([
  ASSISTANT_STOPPED_NOTICE,
  ASSISTANT_REPLY_TIMEOUT_NOTICE,
  ASSISTANT_SEND_HARD_CAP_NOTICE,
]);

export function isDeliveredAssistantContentForSend(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (SYSTEM_NOTICES.has(text)) return false;
  if (text.startsWith("【暂未收到任务正文】")) return false;
  if (text.startsWith("【等待超时】")) return false;
  if (text.startsWith("【已停止】")) return false;
  if (text.startsWith("【发送或服务异常】")) return false;
  return isDeliverableAssistantBody(text);
}

/** 自最后一条用户消息以来，是否已有实质性 assistant 回复落库。 */
export function hasDeliveredAssistantSinceLastUser(messages: readonly LocalMessageRow[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) break;
    const role = message.role.trim().toLowerCase();
    if (role === "user" || role === "human") break;
    if (
      (role === "assistant" || role === "model") &&
      isDeliveredAssistantContentForSend(message.content)
    ) {
      return true;
    }
  }
  return false;
}

export function buildPersistedStreamingDraftContent(draft: string): string {
  const trimmed = draft.trim();
  if (!trimmed) return "";
  if (
    trimmed.includes("【生成已中断") ||
    trimmed.includes("[PAUSED") ||
    trimmed.includes("Send \"continue\"")
  ) {
    return trimmed;
  }
  return `${trimmed}${STREAMING_DRAFT_INTERRUPTED_SUFFIX}`;
}

export async function persistStreamingDraftIfNeeded(
  sessionId: string,
  draft: string,
  messages: readonly LocalMessageRow[],
  options?: { sinceMs?: number; thinking?: string },
): Promise<boolean> {
  const trimmed = draft.trim();
  if (!trimmed) return false;
  if (hasDeliveredAssistantSinceLastUser(messages)) return false;

  const content = buildPersistedStreamingDraftContent(trimmed);
  const row = await upsertTurnAssistantMessage(sessionId, content, {
    sinceMs: options?.sinceMs,
    thinking: options?.thinking?.trim() || undefined,
  });
  return row != null;
}
