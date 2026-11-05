import { ASSISTANT_DISCONNECT_NOTICE } from "../../lib/openclaw/agent-run-timeout";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGatewaySendCatch } from "../session-send-retry";

vi.mock("../gatewayStore", () => ({
  useGatewayStore: {
    getState: vi.fn(() => ({ connState: "connected" })),
    setState: vi.fn(),
  },
}));

vi.mock("../uiStore", () => ({
  useUiStore: {
    getState: vi.fn(() => ({ showToast: vi.fn() })),
  },
}));

describe("session-send-retry", () => {
  const hooks = {
    guardLocalAppend: vi.fn(() => true),
    appendAssistantReply: vi.fn(async () => undefined),
    finalizeStepsOnSendError: vi.fn(),
    rememberRetryableSend: vi.fn(),
    clearRetryableSend: vi.fn(),
    clearPendingSendRecovery: vi.fn(),
    consumeGatewayAbortError: vi.fn(() => null),
    consumeFinishReason: vi.fn(() => null),
    settleDisconnect: vi.fn(),
    appendStoppedNotice: vi.fn(async () => undefined),
    maybeScheduleIdleTimeoutRetry: vi.fn(() => false),
    scheduleAutoRetry: vi.fn(),
    shouldOfferSendRetry: vi.fn(() => true),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("schedules auto retry on transient gateway errors", async () => {
    await handleGatewaySendCatch({
      error: new Error("ECONNRESET"),
      signalAborted: false,
      capturedFinishReason: null,
      replyScanSinceMs: Date.now(),
      sendOpts: { autoRetryAttempt: 0 },
      hooks,
    });
    expect(hooks.scheduleAutoRetry).toHaveBeenCalledWith(500, 1);
    expect(hooks.finalizeStepsOnSendError).not.toHaveBeenCalled();
  });

  it("handles disconnect abort with assistant notice", async () => {
    const appendAssistantReply = vi.fn(async () => undefined);
    await handleGatewaySendCatch({
      error: new Error("aborted"),
      signalAborted: true,
      capturedFinishReason: "disconnect",
      replyScanSinceMs: 456,
      hooks: {
        ...hooks,
        appendAssistantReply,
        consumeFinishReason: vi.fn(() => "disconnect" as const),
      },
    });
    expect(hooks.settleDisconnect).toHaveBeenCalledWith({ showToast: false, setBanner: true });
    expect(appendAssistantReply).toHaveBeenCalledWith(ASSISTANT_DISCONNECT_NOTICE, 456);
    expect(hooks.finalizeStepsOnSendError).toHaveBeenCalled();
  });

  it("handles user abort with stopped notice", async () => {
    await handleGatewaySendCatch({
      error: new Error("aborted"),
      signalAborted: true,
      capturedFinishReason: "user",
      replyScanSinceMs: 123,
      hooks: {
        ...hooks,
        consumeFinishReason: vi.fn(() => "user" as const),
      },
    });
    expect(hooks.clearRetryableSend).toHaveBeenCalled();
    expect(hooks.appendStoppedNotice).toHaveBeenCalledWith(123);
    expect(hooks.finalizeStepsOnSendError).toHaveBeenCalled();
  });
});
