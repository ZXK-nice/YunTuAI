/** Sync assistant text from Gateway `chat.history` after `sessions.send`. */

import { sleepWithSignal } from "../async-utils";
import { PRODUCT_NAME } from "../product-brand";
import {
  isFatalAssistantProbeError,
  isMessagePresentationWarning,
} from "./runtime-error-policy";
import { isDeliveredAssistantContent } from "../chat/deliverable-content";

export type ChatHistoryResult = {
  messages?: unknown[];
};

/** 网关 `chat.history` 的 payload 可能为 `{ messages }`、`{ result: { messages } }` 等 */
export function normalizeChatHistoryMessages(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.messages)) return r.messages;
  for (const k of ["result", "data", "payload"] as const) {
    const inner = r[k];
    if (inner && typeof inner === "object" && Array.isArray((inner as Record<string, unknown>).messages)) {
      return (inner as { messages: unknown[] }).messages;
    }
  }
  return undefined;
}

/** 助手消息若 LLM/工具失败，网关会在 history 中写入 stopReason=error 与 errorMessage。 */
export function extractAssistantErrorFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  const nested = entry.message;
  if (nested && typeof nested === "object" && !isAssistantRole(entry)) {
    return extractAssistantErrorFromMessage(nested);
  }
  if (!isAssistantRole(entry)) return undefined;
  const stop = entry.stopReason ?? entry.stop_reason;
  if (stop === "error" || entry.state === "error") {
    const err =
      (typeof entry.errorMessage === "string" && entry.errorMessage.trim()) ||
      (typeof entry.error === "string" && entry.error.trim()) ||
      "";
    return err.trim() || `${PRODUCT_NAME} 运行出错`;
  }
  return undefined;
}

function formatAssistantError(err: string): string {
  return `[错误] ${err}`;
}

function isAssistantRole(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const role = (message as Record<string, unknown>).role;
  return role === "assistant" || role === "model";
}

/** Best-effort extract visible assistant text (mirrors gateway sanitizer assumptions). */
export function extractAssistantTextFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  if (!isAssistantRole(entry)) return undefined;
  if (typeof entry.text === "string" && entry.text.trim()) return entry.text.trim();
  if (typeof entry.content === "string" && entry.content.trim()) return entry.content.trim();
  if (!Array.isArray(entry.content) || entry.content.length === 0) return undefined;
  const texts: string[] = [];
  for (const block of entry.content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: unknown; text?: unknown };
    if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
  }
  return texts.length > 0 ? texts.join("\n").trim() : undefined;
}

/** history 行可能是 `{ message: { role, errorMessage } }`，先拆到真正的消息体。 */
function assistantPayload(message: unknown): Record<string, unknown> | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  if (isAssistantRole(entry)) return entry;
  const nested = entry.message;
  if (nested && typeof nested === "object" && isAssistantRole(nested)) {
    return nested as Record<string, unknown>;
  }
  return undefined;
}

function countAssistantMessages(messages: unknown[] | undefined): number {
  if (!Array.isArray(messages)) return 0;
  let n = 0;
  for (const m of messages) {
    if (assistantPayload(m)) n += 1;
  }
  return n;
}

/** Last assistant **in transcript order** (not “last with text”). */
function getLastAssistantMessage(messages: unknown[] | undefined): unknown | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const payload = assistantPayload(messages[i]);
    if (payload) return payload;
  }
  return undefined;
}

export type LastAssistantSnapshot = {
  /** Total assistant role rows in `messages`. */
  assistantCount: number;
  /** Visible text from the **last** assistant message only; undefined if tool-only / empty / streaming not ready. */
  lastAssistantText: string | undefined;
};

export function snapshotLastAssistant(messages: unknown[] | undefined): LastAssistantSnapshot {
  const assistantCount = countAssistantMessages(messages);
  const last = getLastAssistantMessage(messages);
  const lastAssistantText = last ? extractAssistantTextFromMessage(last) : undefined;
  return { assistantCount, lastAssistantText };
}

export type AssistantBaseline = {
  assistantCount: number;
  lastAssistantText: string | undefined;
};

export function baselineFromHistory(res: unknown): AssistantBaseline {
  const messages = normalizeChatHistoryMessages(res);
  const s = snapshotLastAssistant(messages);
  return {
    assistantCount: s.assistantCount,
    lastAssistantText: s.lastAssistantText,
  };
}

/** 发送前快照 assistant 基线，poll / WS 兜底共用。 */
export async function fetchAssistantBaseline(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionKey: string,
): Promise<AssistantBaseline> {
  try {
    const pre = await request("chat.history", { sessionKey, limit: 20 });
    return baselineFromHistory(pre);
  } catch {
    return baselineFromHistory({});
  }
}

function takeNewReply(
  baseline: AssistantBaseline,
  messages: unknown[] | undefined,
): string | undefined {
  const cur = snapshotLastAssistant(messages);
  /* New assistant row: wait until that row has display text (avoid falling back to older assistant). */
  if (cur.assistantCount > baseline.assistantCount) {
    const last = getLastAssistantMessage(messages);
    const err = extractAssistantErrorFromMessage(last);
    if (err) {
      const t = cur.lastAssistantText?.trim();
      if (isMessagePresentationWarning(err) && t && isDeliveredAssistantContent(t)) {
        return t;
      }
      return formatAssistantError(err);
    }
    const t = cur.lastAssistantText;
    return t && t.trim() ? t.trim() : undefined;
  }

  /* Same row updated (streaming / in-place): text changed. */
  if (
    cur.assistantCount === baseline.assistantCount &&
    cur.assistantCount > 0 &&
    cur.lastAssistantText &&
    cur.lastAssistantText !== baseline.lastAssistantText
  ) {
    return cur.lastAssistantText.trim();
  }

  return undefined;
}

/** 轮询超时前读取 history 中已落库的 LLM 错误（如 API Key 无效）。 */
export async function fetchAssistantErrorAfterSend(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionKey: string,
  baseline?: AssistantBaseline,
): Promise<string | undefined> {
  try {
    const raw = await request("chat.history", { sessionKey, limit: 20 });
    const messages = normalizeChatHistoryMessages(raw);
    if (baseline) {
      const reply = takeNewReply(baseline, messages);
      if (!reply?.startsWith("[错误]")) return undefined;
      if (!isFatalAssistantProbeError(reply)) return undefined;
      return reply;
    }
    const last = getLastAssistantMessage(messages);
    const err = extractAssistantErrorFromMessage(last);
    return err ? formatAssistantError(err) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * After `sessions.send`, poll `chat.history` until the last assistant message shows new content.
 * `signal` 为中止时结束轮询并返回 `"aborted"`（如用户点击「停止」）。
 */
export async function pollForNewAssistantAfterSend(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  sessionKey: string,
  baseline: AssistantBaseline,
  options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal; preferWs?: boolean },
): Promise<string | "aborted" | undefined> {
  const signal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const preferWs = options?.preferWs === true;
  const start = Date.now();
  let pollIndex = 0;

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) return "aborted";
    if (pollIndex > 0) {
      const elapsed = Date.now() - start;
      const intervalMs =
        options?.intervalMs ??
        (preferWs
          ? pollIndex < 5
            ? 600
            : elapsed < 30_000
              ? 1_200
              : 2_000
          : pollIndex < 10
            ? 200
            : elapsed < 15_000
              ? 450
              : elapsed < 45_000
                ? 900
                : 1_500);
      const w = await sleepWithSignal(intervalMs, signal);
      if (w === "aborted") return "aborted";
    }
    pollIndex += 1;
    if (signal?.aborted) return "aborted";

    const raw = await request("chat.history", { sessionKey, limit: 40 });
    if (signal?.aborted) return "aborted";
    const messages = normalizeChatHistoryMessages(raw);
    const reply = takeNewReply(baseline, messages);
    if (reply) return reply;
  }

  return undefined;
}
