/**
 * 当本地 SQLite 对话比网关 `chat.history` 更长时，在发送前注入接续摘要，
 * 避免隔日或 compaction 后 Agent 丢失同会话上下文。
 */

import type { LocalMessageRow } from "../../stores/sessionStore";
import { normalizeChatHistoryMessages } from "./chat-history-sync";
import {
  isInternalGatewayUserMessage,
  userMessagesEquivalent,
} from "./message-normalize";
import {
  mapGatewayHistoryToRows,
  type GatewayHistoryRow,
} from "./session-history-backfill";
import { buildSessionHandoffSummary } from "./task-orchestration";

export const SESSION_CONTEXT_BRIDGE_MARKER = "【云图会话接续】";

/** 未同步到网关的 user 轮次达到该值才注入（1 = 重启后首轮即可接续）。 */
const MIN_UNSYNCED_USER_TURNS = 1;

/** 接续块总字符上限（含摘要 + 当前正文），避免 prompt 膨胀触发网关超时。 */
const MAX_BRIDGE_PAYLOAD_CHARS = 4_500;

function countUnsyncedLocalUserTurns(
  localMessages: LocalMessageRow[],
  gatewayRows: GatewayHistoryRow[],
): { unsynced: number; unsyncedFromUserIndex: number } {
  const localUsers = localMessages.filter((m) => m.role === "user");
  const gwUsers = gatewayRows
    .filter((r) => r.role === "user")
    .map((r) => r.content)
    .filter((c) => !isInternalGatewayUserMessage(c));

  let gwIdx = 0;
  let unsyncedFromUserIndex = localUsers.length;

  for (let i = 0; i < localUsers.length; i++) {
    const local = localUsers[i]!.content;
    let matched = false;
    for (let j = gwIdx; j < gwUsers.length; j++) {
      if (userMessagesEquivalent(local, gwUsers[j]!)) {
        gwIdx = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) {
      unsyncedFromUserIndex = i;
      break;
    }
  }

  return {
    unsynced: localUsers.length - unsyncedFromUserIndex,
    unsyncedFromUserIndex,
  };
}

function sliceMessagesFromUserIndex(
  messages: LocalMessageRow[],
  userIndex: number,
): LocalMessageRow[] {
  if (userIndex <= 0) return messages;
  const localUsers = messages.filter((m) => m.role === "user");
  const target = localUsers[userIndex];
  if (!target) return messages;
  const idx = messages.findIndex((m) => m.id === target.id);
  return idx >= 0 ? messages.slice(idx) : messages;
}

/** 基于已拉取的 chat.history 注入接续块（供 send-prep 复用，避免二次 RPC）。 */
export function bridgePayloadWithGatewayHistory(
  historyRaw: unknown,
  localMessages: LocalMessageRow[],
  remotePayload: string,
): string {
  const payload = remotePayload.trim();
  if (!payload || payload.includes(SESSION_CONTEXT_BRIDGE_MARKER)) return remotePayload;

  const gatewayRows = mapGatewayHistoryToRows(normalizeChatHistoryMessages(historyRaw));
  const gwUserCount = gatewayRows.filter((r) => r.role === "user").length;
  if (gwUserCount === 0) return remotePayload;

  const { unsynced, unsyncedFromUserIndex } = countUnsyncedLocalUserTurns(
    localMessages,
    gatewayRows,
  );
  if (unsynced < MIN_UNSYNCED_USER_TURNS) return remotePayload;

  const contextSlice = sliceMessagesFromUserIndex(localMessages, unsyncedFromUserIndex);
  const summary = buildSessionHandoffSummary(contextSlice);
  if (!summary.trim()) return remotePayload;

  const bridged = [
    SESSION_CONTEXT_BRIDGE_MARKER,
    "以下为本会话近期对话（网关上下文可能已压缩，供接续参考）：",
    "",
    summary,
    "",
    "---",
    "",
    remotePayload,
  ].join("\n");

  if (bridged.length <= MAX_BRIDGE_PAYLOAD_CHARS) return bridged;

  const budget = Math.max(
    600,
    MAX_BRIDGE_PAYLOAD_CHARS - remotePayload.length - 120,
  );
  const slimSummary =
    summary.length > budget ? `${summary.slice(0, budget - 1)}…` : summary;
  return [
    SESSION_CONTEXT_BRIDGE_MARKER,
    "以下为本会话近期对话（网关上下文可能已压缩，供接续参考）：",
    "",
    slimSummary,
    "",
    "---",
    "",
    remotePayload,
  ].join("\n");
}

/**
 * 若网关 transcript 明显短于本地记录，在 remotePayload 前追加接续块（不改本地展示）。
 */
export async function maybeInjectSessionContextBridge(opts: {
  sessionKey: string;
  remotePayload: string;
  localMessages: LocalMessageRow[];
  request: (
    method: string,
    params: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ) => Promise<unknown>;
}): Promise<string> {
  const sessionKey = opts.sessionKey.trim();
  if (!sessionKey) return opts.remotePayload;

  let raw: unknown;
  try {
    raw = await opts.request("chat.history", { sessionKey, limit: 400 }, { timeoutMs: 45_000 });
  } catch {
    return opts.remotePayload;
  }

  return bridgePayloadWithGatewayHistory(raw, opts.localMessages, opts.remotePayload);
}
