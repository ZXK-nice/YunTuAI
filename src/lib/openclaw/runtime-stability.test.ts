import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSessionStore = {
  syncRemoteForActive: vi.fn(),
  resubscribeAllRemoteSessions: vi.fn(),
  backfillHistoryFromGateway: vi.fn(),
  loadSessions: vi.fn().mockResolvedValue(undefined),
  activeId: "sess-1" as string | null,
  sessions: [{ id: "sess-1", remoteSessionKey: "k1", title: "t", agentId: null, createdAt: "", updatedAt: "" }],
};

vi.mock("../../stores/gatewayStore", () => ({
  useGatewayStore: {
    getState: () => ({ connState: "connected", setState: vi.fn() }),
    setState: vi.fn(),
  },
}));

vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: {
    getState: () => mockSessionStore,
  },
}));

vi.mock("./gateway-runtime", () => ({
  getGatewayClient: () => ({ isHelloOk: true }),
}));

vi.mock("./gateway-capabilities", () => ({
  probeGatewayCapabilities: vi.fn().mockResolvedValue({ supportsChatHistory: true }),
}));

describe("runPostConnectStabilityPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStore.activeId = "sess-1";
    mockSessionStore.backfillHistoryFromGateway.mockResolvedValue(2);
    mockSessionStore.syncRemoteForActive.mockResolvedValue(undefined);
    mockSessionStore.resubscribeAllRemoteSessions.mockResolvedValue(undefined);
  });

  it("runs sync, resubscribe, backfill, and capability probe", async () => {
    const { runPostConnectStabilityPipeline } = await import("./runtime-stability");
    const report = await runPostConnectStabilityPipeline({ skipBulkBackfill: true });
    expect(mockSessionStore.syncRemoteForActive).toHaveBeenCalled();
    expect(mockSessionStore.resubscribeAllRemoteSessions).toHaveBeenCalled();
    expect(mockSessionStore.backfillHistoryFromGateway).toHaveBeenCalledWith("sess-1", {
      reload: true,
      silent: true,
    });
    expect(report.resubscribed).toBe(true);
    expect(report.activeBackfillAppended).toBe(2);
    expect(mockSessionStore.loadSessions).toHaveBeenCalled();
    expect(report.capabilitiesProbed).toBe(true);
  });
});
