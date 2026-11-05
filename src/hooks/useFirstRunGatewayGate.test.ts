import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFirstRunGatewayGate } from "./useFirstRunGatewayGate";
import { useGatewayStore } from "../stores/gatewayStore";

const mocks = vi.hoisted(() => ({
  fetchProvisionStatus: vi.fn(),
  listenProvisionProgress: vi.fn(async () => () => undefined),
  startProvision: vi.fn(async () => undefined),
  requestDesktopConnect: vi.fn(async () => true),
  isDesktopConnectInFlight: vi.fn(() => false),
  applyFallbackConnectError: vi.fn(),
  isFirstRunGatewayPending: vi.fn(() => true),
  markGatewayEverConnected: vi.fn(),
  skipFirstRunGatewayGate: vi.fn(),
}));

vi.mock("../lib/openclaw/provision-bridge", () => ({
  fetchProvisionStatus: mocks.fetchProvisionStatus,
  listenProvisionProgress: mocks.listenProvisionProgress,
  startProvision: mocks.startProvision,
}));
vi.mock("../lib/openclaw/desktop-connect-scheduler", () => ({
  requestDesktopConnect: mocks.requestDesktopConnect,
  isDesktopConnectInFlight: mocks.isDesktopConnectInFlight,
}));
vi.mock("../lib/openclaw/startup-connect-pipeline", () => ({
  FIRST_RUN_CONNECT_MAX_MS: 1_000,
}));
vi.mock("../lib/connect-with-feedback", () => ({
  applyFallbackConnectError: mocks.applyFallbackConnectError,
}));
vi.mock("../lib/first-run-gateway", () => ({
  isFirstRunGatewayPending: mocks.isFirstRunGatewayPending,
  markGatewayEverConnected: mocks.markGatewayEverConnected,
  skipFirstRunGatewayGate: mocks.skipFirstRunGatewayGate,
}));
vi.mock("../lib/openclaw/launch-connect-profile", () => ({
  getConnectGateEscapeMs: () => 40,
}));

const readySnap = {
  needed: false,
  ready: true,
  running: false,
  phase: "done",
  percent: 100,
  message: "完成",
  choiceRequired: false,
  globalAvailable: false,
  bundledReady: true,
  bundledInstallAvailable: true,
  bundledVersion: "1",
};

beforeEach(() => {
  useGatewayStore.setState({
    connState: "disconnected",
    startupPhase: null,
    lastError: null,
  } as never);
  mocks.isFirstRunGatewayPending.mockReturnValue(true);
  mocks.fetchProvisionStatus.mockResolvedValue(readySnap);
  mocks.requestDesktopConnect.mockResolvedValue(true);
  mocks.isDesktopConnectInFlight.mockReturnValue(false);
  mocks.markGatewayEverConnected.mockClear();
  mocks.startProvision.mockClear();
  mocks.requestDesktopConnect.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useFirstRunGatewayGate", () => {
  it("非首启时不激活", () => {
    mocks.isFirstRunGatewayPending.mockReturnValue(false);
    const { result } = renderHook(() => useFirstRunGatewayGate(true));
    expect(result.current.active).toBe(false);
    expect(result.current.passed).toBe(true);
  });

  it("就绪后发起连接", async () => {
    const { result } = renderHook(() => useFirstRunGatewayGate(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.requestDesktopConnect).toHaveBeenCalled();
    expect(result.current.active).toBe(true);
  });

  it("连接成功后标记曾连上网关", async () => {
    const { result, rerender } = renderHook(() => useFirstRunGatewayGate(true));
    await act(async () => {
      useGatewayStore.setState({ connState: "connected" } as never);
      await Promise.resolve();
    });
    rerender();
    expect(result.current.passed).toBe(true);
    expect(mocks.markGatewayEverConnected).toHaveBeenCalled();
  });

  it("需要 provision 时启动安装", async () => {
    mocks.fetchProvisionStatus.mockResolvedValue({
      ...readySnap,
      ready: false,
      needed: true,
      running: false,
    });
    renderHook(() => useFirstRunGatewayGate(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.startProvision).toHaveBeenCalled();
  });

  it("连接失败时透出错误", async () => {
    mocks.requestDesktopConnect.mockResolvedValue(false);
    useGatewayStore.setState({ connState: "error", lastError: "boom" } as never);
    const { result } = renderHook(() => useFirstRunGatewayGate(true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.applyFallbackConnectError).toHaveBeenCalled();
    expect(result.current.connectError).toContain("boom");
    expect(result.current.canEnterOffline).toBe(true);
  });

  it("离线进入主界面且不标记曾连上网关", async () => {
    mocks.requestDesktopConnect.mockResolvedValue(false);
    const { result } = renderHook(() => useFirstRunGatewayGate(true));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.enterOffline();
    });
    expect(result.current.passed).toBe(true);
    expect(result.current.allowOfflineMain).toBe(true);
    expect(result.current.active).toBe(true);
    expect(mocks.markGatewayEverConnected).not.toHaveBeenCalled();
    expect(mocks.skipFirstRunGatewayGate).toHaveBeenCalled();
  });
});
