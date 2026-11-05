/**
 * 从 Gateway `chat.history` 回填本地 SQLite，修复「网关有记录、聊天框空白」。
 * 连接可用时网关为历史真源；本地 DB 为展示缓存与离线回退。
 */

import { isWithinLocalMessageLimit } from "../db-limits";
import { invokeWithAuthRetry } from "../tauri-invoke";
import type { LocalMessageRow } from "../../stores/sessionStore";
import {
  claimMessageFingerprint,
  releaseMessageFingerprint,
  hasRecentSessionMessageFingerprint,
} from "./chat-message-dedup";
import { isCompactionRecoveryError } from "./compaction-recovery";
import {
  normalizeUserMessageForDedup,
  shouldSkipGatewayUserBackfill,
} from "./message-normalize";
import {
  extractAssistantErrorFromMessage,
  extractAssistantTextFromMessage,
  normalizeChatHistoryMessages,
} from "./chat-history-sync";
import { collapseTurnAssistantMessages } from "./collapse-turn-assistant-messages";
import type { GatewayWsClient } from "./gateway-client";

export type GatewayHistoryRow = {
  role: "user" | "assistant";
  content: string;
  /** 可选：网关消息 id，用于更强去重 */
  gatewayId?: string;
  /** 毫秒时间戳字符串；回填时优先使用，避免全部落成「刚刚」 */
  createdAt?: string;
};

function parseGatewayTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return String(Math.floor(ms));
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d+$/.test(t)) return t;
    const parsed = Date.parse(t);
    if (Number.isFinite(parsed)) return String(parsed);
  }
  return undefined;
}

function extractMessageTimestamp(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  for (const key of ["createdAt", "created_at", "timestamp", "ts", "time", "at"] as const) {
    const parsed = parseGatewayTimestamp(entry[key]);
    if (parsed) return parsed;
  }
  return undefined;
}

function isUserRole(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const role = (message as Record<string, unknown>).role;
  return role === "user" || role === "human";
}

export function extractUserTextFromMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  if (!isUserRole(entry)) return undefined;
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

/** 将单条网关 history 行映射为可落库的 user/assistant 文本。 */
export function mapGatewayHistoryMessage(message: unknown): GatewayHistoryRow | undefined {
  if (!message || typeof message !== "object") return undefined;
  const entry = message as Record<string, unknown>;
  const gatewayId =
    typeof entry.id === "string"
      ? entry.id.trim()
      : typeof entry.messageId === "string"
        ? entry.messageId.trim()
        : undefined;

  if (isUserRole(entry)) {
    const text = extractUserTextFromMessage(entry);
    if (!text) return undefined;
    return {
      role: "user",
      content: text,
      gatewayId: gatewayId || undefined,
      createdAt: extractMessageTimestamp(entry),
    };
  }

  const err = extractAssistantErrorFromMessage(entry);
  if (err) {
    return {
      role: "assistant",
      content: `[错误] ${err}`,
      gatewayId: gatewayId || undefined,
      createdAt: extractMessageTimestamp(entry),
    };
  }

  const text = extractAssistantTextFromMessage(entry);
  if (!text) return undefined;
  return { role: "assistant", content: text, gatewayId: gatewayId || undefined, createdAt: extractMessageTimestamp(entry) };
}

/** 将网关 history 数组映射为有序可落库行（跳过 tool/system 等）。 */
export function mapGatewayHistoryToRows(messages: unknown[] | undefined): GatewayHistoryRow[] {
  if (!Array.isArray(messages)) return [];
  const out: GatewayHistoryRow[] = [];
  for (const m of messages) {
    const row = mapGatewayHistoryMessage(m);
    if (row) out.push(row);
  }
  return collapseTurnAssistantMessages(out);
}

export function messageContentFingerprint(role: string, content: string): string {
  return `${role.trim().toLowerCase()}\0${content}`;
}

function isCompactionAssistantRow(content: string): boolean {
  const body = content.replace(/^\[错误\]\s*/, "").trim();
  return isCompactionRecoveryError(body) || isCompactionRecoveryError(content);
}

/** 构建本地已有消息指纹集，用于去重。 */
export function buildLocalMessageFingerprints(messages: LocalMessageRow[]): Set<string> {
  const set = new Set<string>();
  for (const m of messages) {
    if (!m.content?.trim()) continue;
    set.add(messageContentFingerprint(m.role, m.content));
    if (m.role === "user") {
      const norm = normalizeUserMessageForDedup(m.content);
      if (norm && norm !== m.content.trim()) {
        set.add(messageContentFingerprint("user", norm));
      }
    }
  }
  return set;
}

/** 筛出本地缺失、需追加的网关行（保持 transcript 顺序）。 */
export function filterMissingGatewayRows(
  gatewayRows: GatewayHistoryRow[],
  localMessages: LocalMessageRow[],
): GatewayHistoryRow[] {
  const seen = buildLocalMessageFingerprints(localMessages);
  const localUserMessages = localMessages.filter((m) => m.role === "user");
  const missing: GatewayHistoryRow[] = [];
  for (const row of gatewayRows) {
    if (row.role === "user") {
      if (shouldSkipGatewayUserBackfill(row.content, localUserMessages)) continue;
      const display = normalizeUserMessageForDedup(row.content) || row.content.trim();
      const fp = messageContentFingerprint("user", display);
      if (seen.has(fp)) continue;
      seen.add(fp);
      missing.push({ ...row, content: display });
      continue;
    }
    if (row.role === "assistant" && isCompactionAssistantRow(row.content)) continue;
    const fp = messageContentFingerprint(row.role, row.content);
    if (seen.has(fp)) continue;
    seen.add(fp);
    missing.push(row);
  }
  return missing;
}

export type BackfillSessionHistoryResult = {
  fetched: number;
  appended: number;
  skipped: number;
};

const HISTORY_FETCH_LIMIT = 400;
const HISTORY_RPC_MS = 45_000;

/**
 * 从网关拉取 `chat.history` 并合并进本地 DB。
 * 返回 appended 数量；0 表示已同步或无法拉取。
 */
export async function backfillSessionHistoryFromGateway(opts: {
  sessionId: string;
  remoteSessionKey: string;
  localMessages: LocalMessageRow[];
  request: GatewayWsClient["request"];
  /** 会话创建时间，用于无网关时间戳时的有序回填 */
  sessionCreatedAt?: string;
  /** 回填过程中读取最新本地消息（含 WS 实时写入），避免双写 */
  getLatestLocalMessages?: () => LocalMessageRow[];
  /** 发送进行中时中止回填，避免与流式写入竞态 */
  isSendBlocked?: () => boolean;
}): Promise<BackfillSessionHistoryResult> {
  const sessionId = opts.sessionId.trim();
  const sessionKey = opts.remoteSessionKey.trim();
  if (!sessionId || !sessionKey) {
    return { fetched: 0, appended: 0, skipped: 0 };
  }

  let raw: unknown;
  try {
    raw = await opts.request(
      "chat.history",
      { sessionKey, limit: HISTORY_FETCH_LIMIT },
      { timeoutMs: HISTORY_RPC_MS },
    );
  } catch {
    return { fetched: 0, appended: 0, skipped: 0 };
  }

  const gatewayRows = mapGatewayHistoryToRows(normalizeChatHistoryMessages(raw));
  const missing = filterMissingGatewayRows(gatewayRows, opts.localMessages);
  if (missing.length === 0) {
    return { fetched: gatewayRows.length, appended: 0, skipped: gatewayRows.length };
  }

  let appended = 0;
  const baseMs = Number(opts.sessionCreatedAt) || Date.now() - missing.length * 60_000;
  const seen = buildLocalMessageFingerprints(opts.localMessages);

  for (let i = 0; i < missing.length; i++) {
    if (opts.isSendBlocked?.()) break;
    const row = missing[i]!;
    if (!isWithinLocalMessageLimit(row.content)) continue;
    const latest = opts.getLatestLocalMessages?.() ?? opts.localMessages;
    if (hasRecentSessionMessageFingerprint(latest, row.role, row.content)) continue;
    const fp = messageContentFingerprint(row.role, row.content);
    if (seen.has(fp)) continue;
    if (!claimMessageFingerprint(sessionId, row.role, row.content)) continue;
    const createdAt = row.createdAt ?? String(baseMs + i * 1_000);
    try {
      await invokeWithAuthRetry<LocalMessageRow>("db_append_message", {
        sessionId,
        role: row.role,
        content: row.content,
        touchSessionUpdatedAt: false,
        createdAt,
      });
      seen.add(fp);
      appended += 1;
    } catch {
      /* 单条失败不阻断其余 */
    } finally {
      releaseMessageFingerprint(sessionId, row.role, row.content);
    }
  }

  return {
    fetched: gatewayRows.length,
    appended,
    skipped: gatewayRows.length - missing.length,
  };
}
