/**
 * 从本地 SQLite gateway_events 表恢复任务步骤时间线。
 */
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import type { PipelineStep } from "../../types/pipeline-step";
import { normalizeGatewayEvent } from "./gateway-event-schema";

export type GatewayEventRow = {
  id: string;
  sessionId: string | null;
  sessionKey: string | null;
  messageId: string | null;
  sendId: string | null;
  eventName: string;
  payloadJson: string;
  createdAt: string;
};

export async function fetchGatewayEventsForSession(opts: {
  sessionId: string;
  sendId?: string;
  limit?: number;
}): Promise<GatewayEventRow[]> {
  if (!isTauriRuntime()) return [];
  try {
    return await invokeAuthed<GatewayEventRow[]>("gateway_events_list", {
      sessionId: opts.sessionId,
      sendId: opts.sendId ?? null,
      limit: opts.limit ?? 120,
    });
  } catch {
    return [];
  }
}

export function gatewayEventsToPipelineSteps(
  rows: GatewayEventRow[],
  sendId?: string,
): PipelineStep[] {
  const steps: PipelineStep[] = [];
  for (const row of rows) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      payload = row.payloadJson;
    }
    const norm = normalizeGatewayEvent(row.eventName, payload);
    if (!norm) continue;

    const toolCallId = norm.toolCallId;
    if (toolCallId) {
      const idx = steps.findIndex((s) => s.toolCallId === toolCallId);
      if (idx >= 0) {
        steps[idx] = {
          ...steps[idx]!,
          title: norm.title,
          status: norm.status,
          messageId: norm.messageId ?? row.messageId ?? steps[idx]!.messageId,
          sessionKey: norm.sessionKey ?? row.sessionKey ?? steps[idx]!.sessionKey,
          detail: norm.detail,
          endedAt:
            norm.status === "running" || norm.status === "pending"
              ? steps[idx]!.endedAt
              : row.createdAt,
        };
        continue;
      }
    }

    steps.push({
      id: row.id,
      title: norm.title,
      status: norm.status,
      kind: "tool",
      toolCallId,
      sendId: sendId ?? row.sendId ?? undefined,
      messageId: norm.messageId ?? row.messageId ?? undefined,
      sessionKey: norm.sessionKey ?? row.sessionKey ?? undefined,
      startedAt: row.createdAt,
      endedAt:
        norm.status === "running" || norm.status === "pending" ? undefined : row.createdAt,
      detail: norm.detail,
    });
  }
  return steps.slice(-80);
}

export async function loadReplayStepsForSession(
  sessionId: string,
  sendId?: string,
): Promise<PipelineStep[]> {
  const rows = await fetchGatewayEventsForSession({ sessionId, sendId });
  if (rows.length === 0) return [];
  const targetSendId = sendId ?? rows[rows.length - 1]?.sendId ?? undefined;
  const filtered = targetSendId
    ? rows.filter((r) => r.sendId === targetSendId)
    : rows;
  return gatewayEventsToPipelineSteps(filtered, targetSendId ?? undefined);
}
