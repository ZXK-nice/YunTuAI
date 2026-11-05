import type { LocalMessageRow } from "./session-store-types";

/** 单次 IPC 加载的本地消息条数上限（按时间取最近 N 条）。 */
export const MESSAGE_LOAD_LIMIT = 400;

/** 内存中保留的会话消息缓存上限（LRU）。 */
export const MESSAGES_CACHE_MAX = 8;

/** 丢弃过期的 loadMessages 结果，避免快速切换会话时闪回旧内容。 */
export const messagesLoadGen = new Map<string, number>();

export const messagesCacheOrder: string[] = [];

/** 防止 appendStoppedNoticeIfNeeded 并发重复插入「已停止」消息 */
export const appendStoppedNoticeInFlight = new Set<string>();

/** 同会话并发 chat.history 回填合并为一次。 */
export const backfillPromises = new Map<string, Promise<number>>();

export function touchMessageCache(sessionId: string) {
  const i = messagesCacheOrder.indexOf(sessionId);
  if (i >= 0) messagesCacheOrder.splice(i, 1);
  messagesCacheOrder.push(sessionId);
}

export function pruneMessagesCache(
  messagesBySession: Record<string, LocalMessageRow[]>,
  keepIds: Iterable<string>,
): Record<string, LocalMessageRow[]> {
  const keep = new Set(keepIds);
  const keys = Object.keys(messagesBySession);
  if (keys.length <= MESSAGES_CACHE_MAX) return messagesBySession;
  const next = { ...messagesBySession };
  for (const sid of keys) {
    if (!keep.has(sid)) delete next[sid];
  }
  return next;
}
