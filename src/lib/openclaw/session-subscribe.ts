import type { GatewayWsClient } from "./gateway-client";
import { resolveCanonicalSessionKey } from "./session-rpc";
import { sleep } from "../async-utils";

const SUBSCRIBE_RPC_MS = 8_000;

function isStartupUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /UNAVAILABLE|unavailable|startup/i.test(msg);
}

async function rpcWithTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  ms = SUBSCRIBE_RPC_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 网关启动尾段 chat.history 可能短暂 UNAVAILABLE，轻量重试 */
async function pingChatHistory(client: GatewayWsClient, sessionKey: string, limit: number): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(350 * attempt);
    try {
      await rpcWithTimeout(
        "chat.history",
        () => client.request("chat.history", { sessionKey, limit }),
        SUBSCRIBE_RPC_MS,
      );
      return;
    } catch (e) {
      if (!isStartupUnavailable(e) || attempt === 3) return;
    }
  }
}

export type SessionMessagesSubscribeResult = {
  canonicalKey: string;
  /** false：网关未把订阅挂到当前连接（无 connId），事件可能收不到 */
  eventsSubscribed: boolean;
};

const SUBSCRIPTION_CACHE_MAX = 64;

function trimSubscriptionCache() {
  while (subscriptionCache.size > SUBSCRIPTION_CACHE_MAX) {
    const first = subscriptionCache.keys().next().value as string | undefined;
    if (!first) break;
    subscriptionCache.delete(first);
  }
}

/** 任意形式的 key -> 订阅结果（含 eventsSubscribed，避免缓存后误报已订阅）。 */
const subscriptionCache = new Map<string, SessionMessagesSubscribeResult>();

/** 同 key 并发 subscribe 合并为一次 RPC。 */
const subscribeInFlight = new Map<string, Promise<SessionMessagesSubscribeResult>>();

/**
 * 订阅会话消息流（`session.message` / `session.tool` 等需先 subscribe，见 Gateway 文档）。
 * 返回的 **canonicalKey** 应与 WS 事件里的 `sessionKey` 一致；请写入本地并用于后续 RPC。
 * 并轻量调用 `chat.history`，以便连接登记 sessionKey（部分版本用于 chat 事件投递范围）。
 */
export async function ensureSessionsMessagesSubscribed(
  client: GatewayWsClient,
  sessionKey: string,
): Promise<SessionMessagesSubscribeResult> {
  const key = sessionKey.trim();
  if (!key || !client.isHelloOk) {
    return { canonicalKey: key, eventsSubscribed: false };
  }

  const cachedEarly = subscriptionCache.get(key);
  if (cachedEarly?.eventsSubscribed) {
    return cachedEarly;
  }

  const inflight = subscribeInFlight.get(key);
  if (inflight) return inflight;

  const promise = (async (): Promise<SessionMessagesSubscribeResult> => {
    const req = (m: string, p: Record<string, unknown>) => client.request(m, p);
    const resolved =
      (await rpcWithTimeout(
        "resolveSessionKey",
        () => resolveCanonicalSessionKey(req, key),
        SUBSCRIBE_RPC_MS,
      ).catch(() => undefined)) ?? key;

    const cached = subscriptionCache.get(resolved) ?? subscriptionCache.get(key);
    if (cached?.eventsSubscribed) {
      return cached;
    }

    const res = (await rpcWithTimeout(
      "sessions.messages.subscribe",
      () => client.request("sessions.messages.subscribe", { key: resolved }),
      SUBSCRIBE_RPC_MS,
    )) as {
      subscribed?: boolean;
      key?: string;
    };
    const canonical =
      typeof res?.key === "string" && res.key.trim() ? res.key.trim() : resolved;

    const result: SessionMessagesSubscribeResult = {
      canonicalKey: canonical,
      eventsSubscribed: res?.subscribed !== false,
    };
    subscriptionCache.set(key, result);
    subscriptionCache.set(resolved, result);
    subscriptionCache.set(canonical, result);
    trimSubscriptionCache();

    if (result.eventsSubscribed) {
      await pingChatHistory(client, canonical, 1);
    }

    return result;
  })();

  subscribeInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    subscribeInFlight.delete(key);
  }
}

/** 订阅会话索引变更（`sessions.changed`），无参数。 */
export async function ensureSessionsIndexSubscribed(client: GatewayWsClient): Promise<void> {
  if (!client.isHelloOk) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(400 * attempt);
    try {
      await rpcWithTimeout(
        "sessions.subscribe",
        () => client.request("sessions.subscribe", {}),
        SUBSCRIBE_RPC_MS,
      );
      return;
    } catch (e) {
      if (!isStartupUnavailable(e) || attempt === 3) return;
    }
  }
}

/** 断开时需 clear，否则重连后仍用旧映射会出错。 */
export function clearSessionSubscriptionTracking(): void {
  subscriptionCache.clear();
  subscribeInFlight.clear();
}

const SUBSCRIBE_SEND_ATTEMPTS = 2;

/**
 * 发送前订阅：失败则 invalidate 后短重试，减少 silent 弱订阅进入慢路径。
 */
export async function ensureSessionsMessagesSubscribedForSend(
  client: GatewayWsClient,
  sessionKey: string,
): Promise<SessionMessagesSubscribeResult> {
  const key = sessionKey.trim();
  if (!key) return { canonicalKey: "", eventsSubscribed: false };

  let last = await ensureSessionsMessagesSubscribed(client, key);
  for (let attempt = 1; attempt < SUBSCRIBE_SEND_ATTEMPTS && !last.eventsSubscribed; attempt++) {
    invalidateSessionSubscription(key);
    if (last.canonicalKey && last.canonicalKey !== key) {
      invalidateSessionSubscription(last.canonicalKey);
    }
    await sleep(350 * attempt);
    last = await ensureSessionsMessagesSubscribed(client, key);
  }
  return last;
}

/** 强制下次对该 key 重新 subscribe（保留 canonical 映射可选清除）。 */
export function invalidateSessionSubscription(sessionKey: string): void {
  const key = sessionKey.trim();
  if (!key) return;
  subscriptionCache.delete(key);
  subscribeInFlight.delete(key);
  for (const [k, v] of subscriptionCache.entries()) {
    if (v.canonicalKey === key) subscriptionCache.delete(k);
  }
}
