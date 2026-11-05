import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeGatewaySendTimeouts,
  dispatchGatewaySessionsSend,
  prepareGatewaySend,
} from "../session-send-gateway";

vi.mock("../../lib/openclaw/send-prep", () => ({
  prepareSendWithSingleHistory: vi.fn(async () => ({
    baseline: { assistantCount: 0, lastAssistantText: undefined },
    bridgedPayload: "bridged",
  })),
}));

vi.mock("../../lib/openclaw/session-model", () => ({
  patchSessionModelForSend: vi.fn(async () => undefined),
}));

vi.mock("../../lib/openclaw/session-thinking", () => ({
  patchSessionThinkingForSend: vi.fn(async () => undefined),
  resolveThinkingEnabledForSend: () => false,
}));

vi.mock("../../lib/openclaw/local-only-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/openclaw/local-only-policy")>();
  return {
    ...actual,
    patchSessionLocalOnlyForSend: vi.fn(actual.patchSessionLocalOnlyForSend),
  };
});

import { patchSessionLocalOnlyForSend } from "../../lib/openclaw/local-only-policy";

vi.mock("../../lib/chat/chat-files-bridge", () => ({
  chatGetOutputDir: vi.fn(async () => "D:\\out"),
}));

vi.mock("../../lib/openclaw/compaction-recovery", () => ({
  humanizeCompactionRecoveryError: (m: string) => m,
  prepareSessionForSend: vi.fn(async () => ({ blocked: false, compacted: false })),
}));

describe("session-send-gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("computeGatewaySendTimeouts matches production constants", () => {
    const t = computeGatewaySendTimeouts();
    expect(t.replyWaitMs).toBe(600_000);
    expect(t.fallbackPollMs).toBe(180_000);
    expect(t.sendTimeoutMs).toBe(840_000);
  });

  it("prepareGatewaySend builds localOnly send params", async () => {
    const onProgress = vi.fn();
    const result = await prepareGatewaySend({
      sessionKey: "sess-1",
      rpcPayload: "hello",
      remotePayload: "hello",
      localMessages: [],
      localOnlyMode: true,
      taskOrchestration: false,
      modelSelectionId: "deepseek-chat",
      request: vi.fn(),
      onProgress,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sendParams.key).toBe("sess-1");
      expect(result.sendParams.metadata).toEqual({
        yuntuaiLocalOnly: true,
        toolDenylist: expect.arrayContaining(["web_search", "http"]),
      });
      expect(result.rpcPayloadWithOutput).toContain("D:\\out");
    }
    expect(patchSessionLocalOnlyForSend).toHaveBeenCalledWith("sess-1");
  });

  it("dispatchGatewaySessionsSend prefers notify when subscribed", () => {
    const notify = vi.fn(() => true);
    const request = vi.fn();
    const p = dispatchGatewaySessionsSend(
      { notify, request },
      { key: "k", message: "m" },
      true,
    );
    expect(p).toBeNull();
    expect(notify).toHaveBeenCalledWith("sessions.send", { key: "k", message: "m" });
    expect(request).not.toHaveBeenCalled();
  });

  it("dispatchGatewaySessionsSend falls back to request when notify returns false", () => {
    const notify = vi.fn(() => false);
    const request = vi.fn(async () => ({ ok: true }));
    dispatchGatewaySessionsSend({ notify, request }, { key: "k" }, true);
    expect(request).toHaveBeenCalledWith("sessions.send", { key: "k" });
  });
});
