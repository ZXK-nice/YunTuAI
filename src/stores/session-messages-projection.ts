import type { LocalMessageRow } from "./session-store-types";

export function messagesForSession(
  messagesBySession: Record<string, LocalMessageRow[]>,
  sessionId: string | null | undefined,
): LocalMessageRow[] {
  if (!sessionId) return [];
  return messagesBySession[sessionId] ?? [];
}

export function appendMessageToSessionMap(
  messagesBySession: Record<string, LocalMessageRow[]>,
  sessionId: string,
  row: LocalMessageRow,
): Record<string, LocalMessageRow[]> {
  return {
    ...messagesBySession,
    [sessionId]: [...(messagesBySession[sessionId] ?? []), row],
  };
}

export function patchLastUserSendStatusInMap(
  messagesBySession: Record<string, LocalMessageRow[]>,
  sessionId: string,
  status: "sending" | "failed" | undefined,
): Record<string, LocalMessageRow[]> {
  const list = messagesBySession[sessionId];
  if (!list?.length) return messagesBySession;
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    const role = list[i]!.role.trim().toLowerCase();
    if (role === "user" || role === "human") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return messagesBySession;
  const cur = list[idx]!;
  if (cur.sendStatus === status) return messagesBySession;
  const next = list.slice();
  next[idx] = { ...cur, sendStatus: status };
  return { ...messagesBySession, [sessionId]: next };
}
