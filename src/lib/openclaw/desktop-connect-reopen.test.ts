import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGatewayStore } from "../../stores/gatewayStore";

const prepareConnectGateMock = vi.fn();
const isFirstRunGatewayPending = vi.fn();

vi.mock("./connect-gate-prep", () => ({
  prepareConnectGateThenDesktopConnect: (...args: unknown[]) => prepareConnectGateMock(...args),
}));

vi.mock("../first-run-gateway", () => ({
  isFirstRunGatewayPending: () => isFirstRunGatewayPending(),
}));

const { runPostLoginDesktopConnect } = await import("./desktop-connect-scheduler");

describe("runPostLoginDesktopConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirstRunGatewayPending.mockReturnValue(false);
    prepareConnectGateMock.mockResolvedValue(true);
    useGatewayStore.setState({
      connState: "disconnected",
      exclusiveReport: {
        supervisor: { running: true, supervised: true, message: "ok" },
        externalGatewayConflict: false,
        bundledReady: true,
      },
      refreshExclusiveReport: vi.fn(async () => undefined),
    } as never);
  });

  it("skips when first-run gate is pending", async () => {
    isFirstRunGatewayPending.mockReturnValue(true);
    await runPostLoginDesktopConnect(() => false);
    expect(prepareConnectGateMock).not.toHaveBeenCalled();
  });

  it("skips when already connected and clears startupPhase", async () => {
    useGatewayStore.setState({ connState: "connected", startupPhase: "x" } as never);
    await runPostLoginDesktopConnect(() => false);
    expect(prepareConnectGateMock).not.toHaveBeenCalled();
    expect(useGatewayStore.getState().startupPhase).toBeNull();
  });

  it("delegates to connect-gate-prep when disconnected", async () => {
    await runPostLoginDesktopConnect(() => false);
    expect(prepareConnectGateMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ context: "重新打开连接本机服务" }),
    );
  });

  it("honours cancelled before connect", async () => {
    await runPostLoginDesktopConnect(() => true);
    expect(prepareConnectGateMock).not.toHaveBeenCalled();
  });
});
