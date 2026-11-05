/**
 * 同一用户轮次内 assistant 回复只允许存在一条（总汇报）。
 * 所有写入路径必须经此模块，避免工具多步产生碎气泡。
 */

import type { LocalMessageRow } from "../../stores/sessionStore";
import { useSessionStore } from "../../stores/sessionStore";
import {
  claimMessageFingerprint,
  releaseMessageFingerprint,
  shouldSkipDuplicateSessionMessage,
} from "../openclaw/chat-message-dedup";
import { findSupersededAssistantMessageIds } from "../openclaw/collapse-turn-assistant-messages";
import { invokeWithAuthRetry } from "../tauri-invoke";
import { appendAssistantMessageWithFiles } from "./append-message-with-files";
import { sanitizeAssistantPersistContent, parseAssistantMessageForBubble } from "./assistant-message-display";
import {
  isDeliveredAssistantContent,
  partitionAssistantContent,
} from "./deliverable-content";

export function getTrailingAssistantMessageIds(messages: readonly LocalMessageRow[]): string[] {
  const ids: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) break;
    const role = m.role.trim().toLowerCase();
    if (role === "user" || role === "human") break;
    if (role === "assistant" || role === "model") ids.unshift(m.id);
  }
  return ids;
}

async function removeAssistantMessagesFromDb(
  sessionId: string,
  messageIds: readonly string[],
): Promise<void> {
  if (messageIds.length === 0) return;
  for (const messageId of messageIds) {
    try {
      await invokeWithAuthRetry("db_delete_message", { sessionId, messageId });
    } catch {
      /* 单条删除失败不阻断写入 */
    }
  }
  const drop = new Set(messageIds);
  useSessionStore.setState((s) => {
    const list = s.messagesBySession[sessionId];
    if (!list?.length) return s;
    return {
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: list.filter((m) => !drop.has(m.id)),
      },
    };
  });
}

/** 写入本轮 assistant 总汇报：先移除同轮旧回复，再追加最新一条。 */
export async function upsertTurnAssistantMessage(
  sessionId: string,
  content: string,
  options?: { sinceMs?: number; thinking?: string; messages?: LocalMessageRow[] },
): Promise<LocalMessageRow | null> {
  const trimmed = content.trim();
  const thinkingTrim = options?.thinking?.trim() ?? "";
  if (!trimmed && !thinkingTrim) return null;

  const sanitized = sanitizeAssistantPersistContent(trimmed || thinkingTrim, options?.thinking);
  const partitioned = partitionAssistantContent(sanitized.content, sanitized.thinking);
  const persistContent = partitioned.body;
  const persistThinking = partitioned.thinking;
  if (!persistContent.trim() && !persistThinking?.trim()) return null;

  const fingerprintKey =
    persistContent.trim() || `__thinking__${(persistThinking ?? "").slice(0, 160)}`;

  const msgs = options?.messages ?? useSessionStore.getState().messagesBySession[sessionId] ?? [];
  if (shouldSkipDuplicateSessionMessage(sessionId, msgs, "assistant", fingerprintKey)) return null;
  if (!claimMessageFingerprint(sessionId, "assistant", fingerprintKey)) return null;

  const trailingIds = getTrailingAssistantMessageIds(msgs);
  const lastTrailing =
    trailingIds.length > 0 ? msgs.find((m) => m.id === trailingIds[trailingIds.length - 1]) : null;

  if (!persistContent.trim() && persistThinking && lastTrailing) {
    const lastBody = lastTrailing.content.trim();
    if (lastBody && isDeliveredAssistantContent(lastBody)) {
      const parsed = parseAssistantMessageForBubble(lastTrailing.displayContent, lastTrailing.content);
      const mergedThinking = [parsed.thinking, persistThinking].filter(Boolean).join("\n\n").trim();
      if (parsed.thinking === mergedThinking) {
        releaseMessageFingerprint(sessionId, "assistant", fingerprintKey);
        return null;
      }
      try {
        await removeAssistantMessagesFromDb(sessionId, trailingIds);
        const row = await appendAssistantMessageWithFiles(
          sessionId,
          lastBody,
          options?.sinceMs,
          mergedThinking,
        );
        if (row) useSessionStore.getState().appendLocalMessage(sessionId, row);
        return row;
      } finally {
        releaseMessageFingerprint(sessionId, "assistant", fingerprintKey);
      }
    }
  }

  if (
    lastTrailing &&
    (lastTrailing.content.trim() === persistContent ||
      (!persistContent.trim() && lastTrailing.content.trim() === ""))
  ) {
    releaseMessageFingerprint(sessionId, "assistant", fingerprintKey);
    return null;
  }

  try {
    await removeAssistantMessagesFromDb(sessionId, trailingIds);
    const row = await appendAssistantMessageWithFiles(
      sessionId,
      persistContent,
      options?.sinceMs,
      persistThinking,
    );
    if (row) useSessionStore.getState().appendLocalMessage(sessionId, row);
    return row;
  } finally {
    releaseMessageFingerprint(sessionId, "assistant", fingerprintKey);
  }
}

/** 加载会话时清理 DB 中同轮冗余 assistant，只保留总汇报。 */
export async function compactSupersededAssistantMessagesInDb(
  sessionId: string,
  messages: LocalMessageRow[],
): Promise<LocalMessageRow[]> {
  const superseded = findSupersededAssistantMessageIds(messages);
  if (superseded.length === 0) return messages;
  await removeAssistantMessagesFromDb(sessionId, superseded);
  const drop = new Set(superseded);
  return messages.filter((m) => !drop.has(m.id));
}
