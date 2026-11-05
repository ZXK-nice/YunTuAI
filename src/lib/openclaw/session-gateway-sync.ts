/**
 * Gateway-first 会话消息同步：连接可用时优先 `chat.history`，SQLite 作持久化缓存。
 */
import { normalizeChatHistoryMessages } from "./chat-history-sync";
import type { LocalMessageRow, MessageListPage } from "../../stores/sessionStore";
import {
  backfillSessionHistoryFromGateway,
  mapGatewayHistoryToRows,
  type GatewayHistoryRow,
} from "./session-history-backfill";
import type { GatewayWsClient } from "./gateway-client";

const HISTORY_FETCH_LIMIT = 400;
const HISTORY_RPC_MS = 45_000;

export function gatewayRowToPreviewMessage(
  row: GatewayHistoryRow,
  sessionId: string,
  index: number,
): LocalMessageRow {
  const id = row.gatewayId
    ? `gw:${row.gatewayId}`
    : `gw:${sessionId}:${index}:${row.role}`;
  return {
    id,
    sessionId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt ?? String(Date.now() + index),
  };
}

/** 网关行转本地预览列表（不落库，用于回填前的即时展示）。 */
export function gatewayRowsToLocalPreview(
  sessionId: string,
  rows: GatewayHistoryRow[],
): LocalMessageRow[] {
  return rows.map((row, i) => gatewayRowToPreviewMessage(row, sessionId, i));
}

export type GatewayMessageSyncResult = {
  page: MessageListPage;
  backfillAppended: number;
  gatewayFetched: number;
};

/**
 * 连接网关时：先回填缺失历史，再读 SQLite；本地为空但网关有记录时先展示网关预览。
 */
export async function syncSessionMessagesFromGateway(opts: {
  sessionId: string;
  remoteSessionKey: string;
  connConnected: boolean;
  invokeListMessages: () => Promise<MessageListPage>;
  request: GatewayWsClient["request"];
  sessionCreatedAt?: string;
  isSendBlocked?: () => boolean;
  getLatestLocalMessages?: () => LocalMessageRow[];
}): Promise<GatewayMessageSyncResult> {
  const sessionId = opts.sessionId.trim();
  const sessionKey = opts.remoteSessionKey.trim();
  let page = await opts.invokeListMessages();

  if (!opts.connConnected || !sessionKey) {
    return { page, backfillAppended: 0, gatewayFetched: 0 };
  }

  const localBefore = page.messages;
  const backfillResult = await backfillSessionHistoryFromGateway({
    sessionId,
    remoteSessionKey: sessionKey,
    localMessages: localBefore,
    request: opts.request,
    sessionCreatedAt: opts.sessionCreatedAt,
    getLatestLocalMessages: opts.getLatestLocalMessages ?? (() => localBefore),
    isSendBlocked: opts.isSendBlocked,
  });

  if (backfillResult.appended > 0) {
    page = await opts.invokeListMessages();
  } else if (localBefore.length === 0 && backfillResult.fetched > 0) {
    let raw: unknown;
    try {
      raw = await opts.request(
        "chat.history",
        { sessionKey, limit: HISTORY_FETCH_LIMIT },
        { timeoutMs: HISTORY_RPC_MS },
      );
    } catch {
      raw = null;
    }
    const rows = mapGatewayHistoryToRows(normalizeChatHistoryMessages(raw));
    if (rows.length > 0) {
      page = {
        messages: gatewayRowsToLocalPreview(sessionId, rows),
        hasMore: false,
      };
    }
  }

  return {
    page,
    backfillAppended: backfillResult.appended,
    gatewayFetched: backfillResult.fetched,
  };
}
