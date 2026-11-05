/**
 * 断线期间网关可能仍在执行任务。重连后自动回填 history、探测产出并收口任务交付，
 * 避免本地过早标「已取消」而用户看不到结果。
 */
import { upsertTurnAssistantMessage } from "../chat/upsert-turn-assistant-message";
import {
  fetchAssistantBaseline,
  fetchAssistantErrorAfterSend,
  pollForNewAssistantAfterSend,
} from "./chat-history-sync";
import { finalizeTaskDelivery, getTaskDeliverySummary } from "./task-delivery";
import {
  humanizeGatewayTimeoutError,
  isAgentRunTimeoutError,
} from "./agent-run-timeout";
import { humanizeAssistantRuntimeError } from "./runtime-error-policy";
import { getGatewayClient } from "./gateway-runtime";
import { useSessionStore, type SendMessageInput } from "../../stores/sessionStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";

export type PendingSendRecovery = {
  sessionId: string;
  sessionKey: string;
  sendStartedAtMs: number;
  originalInput: SendMessageInput;
};

const RECOVERY_POLL_MS = 90_000;

let pending: PendingSendRecovery | null = null;

export function registerPendingSendRecovery(recovery: PendingSendRecovery): void {
  pending = recovery;
}

export function clearPendingSendRecovery(): void {
  pending = null;
}

export function getPendingSendRecovery(): PendingSendRecovery | null {
  return pending;
}

function assistantTextSince(sessionId: string, sinceMs: number): string {
  const msgs = useSessionStore.getState().messagesBySession[sessionId] ?? [];
  return msgs
    .filter(
      (m) =>
        m.role === "assistant" &&
        Number(m.createdAt) >= sinceMs - 3_000 &&
        !m.content.startsWith("【生成已中断"),
    )
    .map((m) => m.content)
    .join("\n")
    .trim();
}

async function settleRecoveredSend(
  sessionId: string,
  sendStartedAtMs: number,
  assistantText: string,
): Promise<void> {
  clearPendingSendRecovery();
  useSessionStore.setState({ lastRetryableSend: null });
  useGatewayStore.setState({ lastError: null });
  await finalizeTaskDelivery(sessionId, sendStartedAtMs, {
    hadAssistantText: Boolean(assistantText),
    assistantText,
    toast: true,
  }).catch(() => undefined);
  useUiStore.getState().showToast("断线期间任务已完成，结果已同步", "success");
}

async function settleFailedRecovery(
  sessionId: string,
  sendStartedAtMs: number,
  errLine: string,
): Promise<void> {
  const displayErr = isAgentRunTimeoutError(errLine)
    ? humanizeGatewayTimeoutError(errLine)
    : humanizeAssistantRuntimeError(errLine);
  useGatewayStore.setState({ lastError: displayErr });
  await finalizeTaskDelivery(sessionId, sendStartedAtMs, {
    hadAssistantText: false,
    toast: false,
    cancelled: true,
    cancelReason: "error",
  }).catch(() => undefined);
  clearPendingSendRecovery();
}

/** 重连后尝试回收断线期间可能已完成的网关任务。 */
export async function tryRecoverPendingSendAfterReconnect(): Promise<boolean> {
  const p = pending;
  if (!p) return false;
  if (useGatewayStore.getState().connState !== "connected") return false;
  if (useSessionStore.getState().isSending) return false;

  const { sessionId, sessionKey, sendStartedAtMs } = p;
  const existing = getTaskDeliverySummary(sessionId);
  if (existing?.outcome === "completed" || existing?.outcome === "partial") {
    clearPendingSendRecovery();
    return true;
  }

  await useSessionStore
    .getState()
    .backfillHistoryFromGateway(sessionId, { reload: true, silent: true })
    .catch(() => 0);

  const syncedText = assistantTextSince(sessionId, sendStartedAtMs);
  if (syncedText) {
    await settleRecoveredSend(sessionId, sendStartedAtMs, syncedText);
    return true;
  }

  const client = getGatewayClient();
  if (!client.isHelloOk) return false;

  let baseline;
  try {
    baseline = await fetchAssistantBaseline(
      (method, params) => client.request(method, params),
      sessionKey,
    );
  } catch {
    return false;
  }

  const reply = await pollForNewAssistantAfterSend(
    (method, params) => client.request(method, params),
    sessionKey,
    baseline,
    { timeoutMs: RECOVERY_POLL_MS },
  );

  if (reply && reply !== "aborted") {
    await upsertTurnAssistantMessage(sessionId, reply, { sinceMs: sendStartedAtMs });
    await settleRecoveredSend(sessionId, sendStartedAtMs, reply);
    return true;
  }

  const errLine = await fetchAssistantErrorAfterSend(
    (method, params) => client.request(method, params),
    sessionKey,
    baseline,
  ).catch(() => undefined);

  if (errLine) {
    await settleFailedRecovery(sessionId, sendStartedAtMs, errLine);
    return false;
  }

  return false;
}
