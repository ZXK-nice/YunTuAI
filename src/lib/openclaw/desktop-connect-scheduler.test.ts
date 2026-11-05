import { describe, expect, it, vi, beforeEach } from "vitest";
import { requestDesktopConnect, isDesktopConnectInFlight } from "./desktop-connect-scheduler";

const connectWithFeedback = vi.fn();
const runStartupConnectPipeline = vi.fn();
const isFirstRunGatewayPending = vi.fn();

vi.mock("../connect-with-feedback", () => ({
  connectWithFeedback: (...args: unknown[]) => connectWithFeedback(...args),
  wireDesktopConnectInFlight: vi.fn(),
  ensureBackgroundConnecting: vi.fn(),
}));

vi.mock("./startup-connect-pipeline", () => ({
  FIRST_RUN_CONNECT_MAX_MS: 180_000,
  STARTUP_CONNECT_MAX_MS: 30_000,
  REOPEN_CONNECT_MAX_MS: 28_000,
  runStartupConnectPipeline: (...args: unknown[]) => runStartupConnectPipeline(...args),
}));

vi.mock("../first-run-gateway", () => ({
  isFirstRunGatewayPending: () => isFirstRunGatewayPending(),
}));

vi.mock("../../stores/gatewayStore", () => ({
  useGatewayStore: {
    getState: vi.fn(() => ({
      connState: "disconnected",
      startupPhase: null,
    })),
    setState: vi.fn(),
  },
}));

describe("requestDesktopConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirstRunGatewayPending.mockReturnValue(false);
    connectWithFeedback.mockResolvedValue(true);
    runStartupConnectPipeline.mockResolvedValue(true);
  });

  it("dedupes concurrent requests", async () => {
    const p1 = requestDesktopConnect({ direct: true });
    const p2 = requestDesktopConnect({ direct: true });
    expect(isDesktopConnectInFlight()).toBe(true);
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(connectWithFeedback).toHaveBeenCalledTimes(1);
    expect(isDesktopConnectInFlight()).toBe(false);
  });

  it("uses startup pipeline on first run when not direct", async () => {
    isFirstRunGatewayPending.mockReturnValue(true);
    await requestDesktopConnect();
    expect(runStartupConnectPipeline).toHaveBeenCalled();
    expect(connectWithFeedback).not.toHaveBeenCalled();
  });

  it("uses connectWithFeedback when direct", async () => {
    isFirstRunGatewayPending.mockReturnValue(true);
    await requestDesktopConnect({ direct: true, context: "skip" });
    expect(connectWithFeedback).toHaveBeenCalledWith(
      "skip",
      expect.objectContaining({ skipPrepare: undefined, forceRepair: undefined }),
    );
    expect(runStartupConnectPipeline).not.toHaveBeenCalled();
  });
});
