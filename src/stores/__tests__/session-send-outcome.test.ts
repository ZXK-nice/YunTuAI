import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleGatewaySendOutcome } from "../session-send-outcome";

vi.mock("../gatewayStore", () => ({
  useGatewayStore: {
    getState: () => ({ connState: "connected" }),
    setState: vi.fn(),
  },
}));

vi.mock("../stepStore", () => ({
  useStepStore: {
    getState: () => ({
      steps: [],
      replaceSteps: vi.fn(),
      finalizeStaleRunningSteps: vi.fn(),
    }),
  },
}));

vi.mock("../uiStore", () => ({
  useUiStore: {
    getState: () => ({
      showToast: vi.fn(),
      requestOpenSidePanel: vi.fn(),
    }),
  },
}));

vi.mock("../../lib/openclaw/task-delivery", () => ({
  finalizeTaskDelivery: vi.fn(async () => null),
  shouldPreferToolOnlyNotice: () => false,
  buildToolOnlyCompletionNotice: () => "tool only",
  ASSISTANT_REPLY_TIMEOUT_NOTICE: "timeout notice",
}));

vi.mock("../../lib/openclaw/task-orchestration", () => ({
  parseTaskPlanFromAssistant: () => null,
  mergeParsedPlanIntoSteps: (steps: unknown[]) => steps,
  scheduleParallelSubtasksFollowUp: vi.fn(),
}));

vi.mock("../../lib/openclaw/chat-history-sync", () => ({
  fetchAssistantErrorAfterSend: vi.fn(async () => undefined),
}));

describe("session-send-outcome", () => {
  const hooks = {
    guardLocalAppend: () => true,
    appendAssistantReply: vi.fn(async () => undefined),
    getRecentAssistantText: () => "assistant reply",
    tryAutoTitleSession: vi.fn(),
    persistStreamingDraftIfNeeded: vi.fn(async () => false),
    finalizeStepsOnSendError: vi.fn(),
    maybeScheduleIdleTimeoutRetry: vi.fn(() => false),
    scheduleCompactionRetry: vi.fn(),
    settleDisconnect: vi.fn(),
    appendStoppedNotice: vi.fn(async () => undefined),
    rememberRetryableSend: vi.fn(),
    clearRetryableSend: vi.fn(),
    clearPendingSendRecovery: vi.fn(),
    consumeGatewayAbortError: () => null,
    hasDeliveredAssistantSinceLastUser: () => false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears errors on ws_complete success path", async () => {
    const { useGatewayStore } = await import("../gatewayStore");
    await settleGatewaySendOutcome({
      sessionId: "s1",
      sendId: "send-1",
      localDisplay: "hi",
      sessionKey: "key-1",
      originalInput: "hi",
      reply: "ws_complete",
      compactionRetryScheduled: false,
      capturedFinishReason: "ws_complete",
      baseline: { assistantCount: 1, lastAssistantText: "x" },
      replyScanSinceMs: Date.now(),
      request: vi.fn(),
      hooks,
    });
    expect(useGatewayStore.setState).toHaveBeenCalledWith({ lastError: null });
    expect(hooks.clearRetryableSend).toHaveBeenCalled();
  });

  it("appends string reply on success", async () => {
    await settleGatewaySendOutcome({
      sessionId: "s1",
      sendId: "send-1",
      localDisplay: "hi",
      sessionKey: "key-1",
      originalInput: "hi",
      reply: "done",
      compactionRetryScheduled: false,
      capturedFinishReason: null,
      baseline: { assistantCount: 0, lastAssistantText: undefined },
      replyScanSinceMs: Date.now(),
      request: vi.fn(),
      hooks,
    });
    expect(hooks.appendAssistantReply).toHaveBeenCalledWith("done", expect.any(Number));
  });
});
