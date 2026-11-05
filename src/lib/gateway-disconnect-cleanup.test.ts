import { beforeEach, describe, expect, it, vi } from "vitest";

const resetSpy = vi.fn();

vi.mock("./openclaw/apply-chat-final-event", () => ({
  resetChatEventDedupState: () => resetSpy(),
}));

const sessionState = {
  isSending: false,
  sendingSessionId: null as string | null,
  activeId: "s1" as string | null,
  persistStreamingDraftIfNeeded: vi.fn(async () => true),
  abortActiveSend: vi.fn(),
  clearStreamingDraftForActive: vi.fn(),
  clearThinkingDraftForActive: vi.fn(),
};

const stepState = {
  finalizeStaleRunningSteps: vi.fn(),
  clear: vi.fn(),
};

vi.mock("../stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => sessionState,
  },
}));

vi.mock("../stores/stepStore", () => ({
  useStepStore: {
    getState: () => stepState,
  },
}));

describe("cleanupGatewaySessionState", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionState.isSending = false;
    sessionState.sendingSessionId = null;
    sessionState.activeId = "s1";
  });

  it("preserves chat dedup while a send is in flight and task is not stopped", async () => {
    const { cleanupGatewaySessionState } = await import("./gateway-disconnect-cleanup");
    sessionState.isSending = true;
    sessionState.sendingSessionId = "s1";

    cleanupGatewaySessionState({ stopActiveTask: false });

    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("resets chat dedup when disconnect stops the active task", async () => {
    const { cleanupGatewaySessionState } = await import("./gateway-disconnect-cleanup");
    sessionState.isSending = true;
    sessionState.sendingSessionId = "s1";

    cleanupGatewaySessionState({ stopActiveTask: true });

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(sessionState.abortActiveSend).toHaveBeenCalledWith("user");
  });
});
