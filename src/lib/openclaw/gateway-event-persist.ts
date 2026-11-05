/**
 * 将网关事件批量写入本地 SQLite，供步骤回放与排障。
 */
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

export type { NormalizedGatewayEvent } from "./gateway-event-schema";
export { extractGatewayEventIds, normalizeGatewayEvent } from "./gateway-event-schema";

export type GatewayEventPersistRow = {
  id: string;
  sessionId?: string;
  sessionKey?: string;
  messageId?: string;
  sendId?: string;
  eventName: string;
  payloadJson: string;
  createdAt: string;
};

const pending: GatewayEventPersistRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 120;
const MAX_BATCH = 40;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushGatewayEventBatch();
  }, FLUSH_MS);
}

export function queueGatewayEventPersist(row: GatewayEventPersistRow): void {
  if (!isTauriRuntime()) return;
  pending.push(row);
  if (pending.length >= MAX_BATCH) {
    void flushGatewayEventBatch();
    return;
  }
  scheduleFlush();
}

export async function flushGatewayEventBatch(): Promise<void> {
  if (!isTauriRuntime() || pending.length === 0) return;
  const batch = pending.splice(0, MAX_BATCH);
  try {
    await invokeAuthed("gateway_event_persist_batch", {
      rows: batch.map((r) => ({
        id: r.id,
        sessionId: r.sessionId ?? null,
        sessionKey: r.sessionKey ?? null,
        messageId: r.messageId ?? null,
        sendId: r.sendId ?? null,
        eventName: r.eventName,
        payloadJson: r.payloadJson,
        createdAt: r.createdAt,
      })),
    });
  } catch {
    pending.unshift(...batch);
  }
  if (pending.length > 0) scheduleFlush();
}
