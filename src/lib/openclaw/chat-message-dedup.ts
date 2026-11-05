import type { LocalMessageRow } from "../../stores/sessionStore";
import { messageContentFingerprint } from "./session-history-backfill";

/** 检查最近 N 条是否已有相同 role+content（防并发/回填双写）。 */
const RECENT_TAIL = 16;

export function hasRecentSessionMessageFingerprint(
  messages: LocalMessageRow[],
  role: string,
  content: string,
  tail = RECENT_TAIL,
): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const fp = messageContentFingerprint(role, trimmed);
  const slice = messages.length <= tail ? messages : messages.slice(-tail);
  for (const m of slice) {
    if (!m.content?.trim()) continue;
    if (messageContentFingerprint(m.role, m.content) === fp) return true;
  }
  return false;
}

const inFlightBySession = new Map<string, Set<string>>();

/** 占用指纹；若已有同会话同内容写入在进行中则返回 false。 */
export function claimMessageFingerprint(sessionId: string, role: string, content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  const fp = messageContentFingerprint(role, trimmed);
  let set = inFlightBySession.get(sessionId);
  if (!set) {
    set = new Set();
    inFlightBySession.set(sessionId, set);
  }
  if (set.has(fp)) return false;
  set.add(fp);
  return true;
}

export function releaseMessageFingerprint(sessionId: string, role: string, content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;
  const fp = messageContentFingerprint(role, trimmed);
  const set = inFlightBySession.get(sessionId);
  if (!set) return;
  set.delete(fp);
  if (set.size === 0) inFlightBySession.delete(sessionId);
}

export function clearMessageFingerprintClaims(sessionId?: string): void {
  if (sessionId) {
    inFlightBySession.delete(sessionId);
    return;
  }
  inFlightBySession.clear();
}

export function shouldSkipDuplicateSessionMessage(
  sessionId: string,
  messages: LocalMessageRow[],
  role: string,
  content: string,
): boolean {
  if (hasRecentSessionMessageFingerprint(messages, role, content)) return true;
  const trimmed = content.trim();
  if (!trimmed) return true;
  const fp = messageContentFingerprint(role, trimmed);
  const inflight = inFlightBySession.get(sessionId);
  return inflight?.has(fp) === true;
}
