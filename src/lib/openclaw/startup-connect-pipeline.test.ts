import { describe, expect, it, vi, beforeEach } from "vitest";
import { STARTUP_CONNECT_MAX_MS, runStartupConnectPipeline } from "./startup-connect-pipeline";

const waitForGatewayReady = vi.fn();
const prepareGatewayForConnect = vi.fn();
const connectWithFeedback = vi.fn();

vi.mock("./gateway-ready-wait", () => ({
  waitForGatewayReady: (...args: unknown[]) => waitForGatewayReady(...args),
}));

vi.mock("./launch-connect-profile", () => ({
  getLaunchConnectProfile: () => ({
    freshSystemBoot: false,
    trayMode: false,
    gatewayReadyMaxMs: 12_000,
    startupConnectMaxMs: 45_000,
    postLoginGatewayWaitMs: 25_000,
    connectReadyWaitMs: 10_000,
    wakeProbeCooldownMs: 8_000,
  }),
}));

vi.mock("./gateway-connect-preflight", () => ({
  prepareGatewayForConnect: () => prepareGatewayForConnect(),
}));

vi.mock("../connect-with-feedback", () => ({
  connectWithFeedback: (...args: unknown[]) => connectWithFeedback(...args),
  setConnectPipelinePhase: vi.fn(),
  invalidateConnectPipeline: vi.fn(),
}));

vi.mock("../../stores/gatewayStore", () => ({
  useGatewayStore: {
    setState: vi.fn(),
    getState: vi.fn(() => ({ lastError: null })),
  },
}));

describe("runStartupConnectPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForGatewayReady.mockResolvedValue(undefined);
    prepareGatewayForConnect.mockResolvedValue(undefined);
    connectWithFeedback.mockResolvedValue(true);
  });

  it("runs wait → prepare → connect in order", async () => {
    const ok = await runStartupConnectPipeline({ maxMs: STARTUP_CONNECT_MAX_MS });
    expect(ok).toBe(true);
    expect(waitForGatewayReady).toHaveBeenCalled();
    expect(prepareGatewayForConnect).toHaveBeenCalled();
    expect(connectWithFeedback).toHaveBeenCalledWith(undefined, {
      skipPrepare: true,
      cancelled: expect.any(Function),
      maxMs: expect.any(Number),
      coalesceDesktop: false,
    });
  });

  it("returns false when cancelled before connect", async () => {
    let n = 0;
    const ok = await runStartupConnectPipeline({
      maxMs: STARTUP_CONNECT_MAX_MS,
      cancelled: () => {
        n += 1;
        return n >= 2;
      },
    });
    expect(ok).toBe(false);
    expect(connectWithFeedback).not.toHaveBeenCalled();
  });

  it("returns false on connect failure", async () => {
    connectWithFeedback.mockResolvedValue(false);
    const ok = await runStartupConnectPipeline({ maxMs: STARTUP_CONNECT_MAX_MS });
    expect(ok).toBe(false);
  });
});
