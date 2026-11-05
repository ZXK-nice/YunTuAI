/** 同 sessionKey 的 chat 事件串行处理，避免并发 final 事件重复落库。 */

const chains = new Map<string, Promise<void>>();

export function runQueuedChatEvent(sessionKey: string, fn: () => Promise<void>): Promise<void> {
  const key = sessionKey.trim().toLowerCase() || "__none__";
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(() => fn()).catch(() => undefined);
  chains.set(key, next);
  return next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

export function resetChatEventQueues(): void {
  chains.clear();
}
