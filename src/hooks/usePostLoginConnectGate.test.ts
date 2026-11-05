import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePostLoginConnectGate, CONNECT_GATE_ESCAPE_MS } from "./usePostLoginConnectGate";
import { useGatewayStore } from "../stores/gatewayStore";

const mocks = vi.hoisted(() => ({
  prepareConnectGateThenDesktopConnect: vi.fn(async () => true),
  isDesktopConnectInFlight: vi.fn(() => false),
  applyFallbackConnectError: vi.fn(),
}));

vi.mock("../lib/openclaw/connect-gate-prep", () => ({
  prepareConnectGateThenDesktopConnect: mocks.prepareConnectGateThenDesktopConnect,
}));
vi.mock("../lib/openclaw/desktop-connect-scheduler", () => ({
  isDesktopConnectInFlight: mocks.isDesktopConnectInFlight,
}));
vi.mock("../lib/openclaw/launch-connect-profile", () => ({
  getLaunchConnectProfile: () => ({
    freshSystemBoot: false,
    trayMode: false,
    gatewayReadyMaxMs: 8_000,
    startupConnectMaxMs: 36_000,
    postLoginGatewayWaitMs: 18_000,
    connectReadyWaitMs: 8_000,
    wakeProbeCooldownMs: 8_000,
  }),
  applyLaunchConnectProfile: () => null,
  getConnectGateEscapeMs: () => CONNECT_GATE_ESCAPE_MS,
}));
vi.mock("../lib/openclaw/startup-connect-pipeline", () => ({
  REOPEN_CONNECT_MAX_MS: 28_000,
}));
vi.mock("../lib/connect-with-feedback", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/connect-with-feedback")>();
  return {
    ...actual,
    applyFallbackConnectError: mocks.applyFallbackConnectError,
  };
});

function setStore(patch: Record<string, unknown>): void {
  useGatewayStore.setState(patch as never);
}

beforeEach(() => {
  setStore({
    connState: "disconnected",
    startupPhase: null,
    lastError: null,
    exclusiveReport: {
      supervisor: { running: true, supervised: true, message: "ok" },
      externalGatewayConflict: false,
      bundledReady: true,
    },
    autoReconnect: true,
    reconnectDueAt: null,
    refreshExclusiveReport: vi.fn(async () => undefined),
  });
  mocks.prepareConnectGateThenDesktopConnect.mockClear();
  mocks.isDesktopConnectInFlight.mockReturnValue(false);
});

describe("usePostLoginConnectGate", () => {
  it("不启用时直接放行且不发起连接", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(false));
    expect(result.current.gated).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.prepareConnectGateThenDesktopConnect).not.toHaveBeenCalled();
  });

  it("启用且未连接时停在加载页，并发起一次连接", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.prepareConnectGateThenDesktopConnect).toHaveBeenCalledTimes(1);
    expect(useGatewayStore.getState().connState).toBe("connecting");
  });

  it("连接成功后保持放行", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    await act(async () => {
      setStore({ connState: "connected" });
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(false);
    expect(result.current.label).toBe("即将进入");
  });

  it("连接失败时仍停在加载页并给出错误", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    await act(async () => {
      setStore({ connState: "error", lastError: "boom" });
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeTruthy();
    expect(result.current.retry).toBeTypeOf("function");
    expect(result.current.canEscape).toBe(true);
  });

  it("自动重连排程中不显示终态失败", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    await act(async () => {
      setStore({ connState: "error", lastError: "boom", reconnectDueAt: Date.now() + 5_000 });
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.label).toContain("自动重连中");
  });

  it("用户选择离线进入后仍保持放行", async () => {
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    await act(async () => {
      result.current.enterOffline();
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(false);
    expect(result.current.allowOfflineMain).toBe(true);
  });

  it("等待超过阈值后出现离线进入出口", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePostLoginConnectGate(true));
    expect(result.current.canEscape).toBe(false);
    act(() => {
      vi.advanceTimersByTime(CONNECT_GATE_ESCAPE_MS + 1);
    });
    expect(result.current.canEscape).toBe(true);
    vi.useRealTimers();
  });

  it("登出后重置离线选择，下次登录在连上前继续停在加载页", async () => {
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) => usePostLoginConnectGate(props.enabled),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      result.current.enterOffline();
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(false);
    rerender({ enabled: false });
    expect(result.current.gated).toBe(false);
    await act(async () => {
      rerender({ enabled: true });
      await Promise.resolve();
    });
    expect(result.current.gated).toBe(true);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
