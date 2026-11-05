import type { SessionMessagesSubscribeResult } from "../lib/openclaw/session-subscribe";

export type SessionSubscriptionHealth = "local_only" | "push_ok" | "push_weak" | "pending";

/** 根据远程 key 与 subscribe 结果解析订阅健康度。 */
export function resolveSubscriptionHealth(
  hasRemoteKey: boolean,
  sub?: SessionMessagesSubscribeResult,
): SessionSubscriptionHealth {
  if (!hasRemoteKey) return "local_only";
  if (!sub) return "push_weak";
  return sub.eventsSubscribed ? "push_ok" : "push_weak";
}

/** 选取应写入 DB 的 canonical session key。 */
export function pickCanonicalRemoteKey(
  askedKey: string,
  sub: SessionMessagesSubscribeResult,
): string {
  const canonical = sub.canonicalKey.trim();
  const asked = askedKey.trim();
  return canonical || asked;
}

export function shouldPersistCanonicalKey(askedKey: string, canonical: string): boolean {
  const asked = askedKey.trim();
  const canon = canonical.trim();
  return Boolean(canon && canon !== asked);
}
