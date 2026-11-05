/**
 * 处理网关 `sessions.changed`：对齐订阅并在活跃会话变更时触发历史回填。
 */
import { invalidateSessionSubscription } from "./session-subscribe";

export function parseSessionsChangedKeys(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const keys: string[] = [];

  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) keys.push(value.trim());
  };

  push(p.key);
  push(p.sessionKey);

  if (Array.isArray(p.keys)) {
    for (const item of p.keys) push(item);
  }

  if (Array.isArray(p.sessions)) {
    for (const item of p.sessions) {
      if (typeof item === "string") {
        push(item);
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      push(entry.key);
      push(entry.sessionKey);
    }
  }

  const data = p.data;
  if (data && typeof data === "object") {
    keys.push(...parseSessionsChangedKeys(data));
  }

  return [...new Set(keys)];
}

export type SessionsChangedDeps = {
  resubscribeAll: (opts?: { background?: boolean }) => Promise<void>;
  subscribeKey: (key: string) => Promise<void>;
  getActiveSession: () => { id: string; remoteSessionKey?: string | null } | null;
  backfillActive: (sessionId: string) => Promise<number>;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 180;
const MAX_KEYS_PER_EVENT = 12;

async function runSessionsChangedSync(
  keys: string[],
  deps: SessionsChangedDeps,
): Promise<void> {
  if (keys.length === 0) {
    await deps.resubscribeAll({ background: true });
    return;
  }

  for (const key of keys.slice(0, MAX_KEYS_PER_EVENT)) {
    invalidateSessionSubscription(key);
    await deps.subscribeKey(key);
  }

  const active = deps.getActiveSession();
  const activeKey = active?.remoteSessionKey?.trim();
  if (!active || !activeKey) return;

  const touched = keys.some(
    (k) => k === activeKey || k.toLowerCase() === activeKey.toLowerCase(),
  );
  if (touched) {
    await deps.backfillActive(active.id);
  }
}

/** 防抖合并短时间内的多次 sessions.changed。 */
export function handleGatewaySessionsChanged(
  payload: unknown,
  deps: SessionsChangedDeps,
): void {
  const keys = parseSessionsChangedKeys(payload);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSessionsChangedSync(keys, deps).catch(() => undefined);
  }, DEBOUNCE_MS);
}

/** 测试用：清除防抖定时器。 */
export function resetSessionsChangedDebounceForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
