import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useStartupConnectGate } from "./useStartupConnectGate";

const firstRunMock = vi.hoisted(() => ({
  active: false,
  passed: true,
  showProvision: false,
  snapshot: null as null | Record<string, unknown>,
  connectLabel: "首启连接",
  connectError: null as string | null,
  retryConnect: vi.fn(),
  enterOffline: vi.fn(),
  canEnterOffline: false,
  allowOfflineMain: false,
}));

const postLoginMock = vi.hoisted(() => ({
  gated: false,
  label: "日常连接",
  error: null as string | null,
  retry: vi.fn(),
  enterOffline: vi.fn(),
  canEscape: false,
  allowOfflineMain: false,
}));

vi.mock("./useFirstRunGatewayGate", () => ({
  useFirstRunGatewayGate: () => firstRunMock,
}));

vi.mock("./usePostLoginConnectGate", () => ({
  usePostLoginConnectGate: (enabled: boolean) => ({
    ...postLoginMock,
    gated: enabled && postLoginMock.gated,
  }),
}));

describe("useStartupConnectGate", () => {
  it("首启 provision 模式优先于日常连接门", () => {
    firstRunMock.active = true;
    firstRunMock.passed = false;
    firstRunMock.showProvision = true;
    firstRunMock.snapshot = {
      needed: true,
      ready: false,
      running: true,
      phase: "extract",
      percent: 40,
      message: "解压中",
      choiceRequired: false,
      globalAvailable: false,
      bundledReady: true,
      bundledInstallAvailable: true,
      bundledVersion: "1",
    };

    const { result } = renderHook(() =>
      useStartupConnectGate(true, { provisionRetry: vi.fn() }),
    );
    expect(result.current.active).toBe(true);
    expect(result.current.mode).toBe("provision");
    expect(result.current.provisionSnapshot?.phase).toBe("extract");
    expect(result.current.canEnterOffline).toBe(false);
  });

  it("首启连接等待后可离线进入", () => {
    firstRunMock.active = true;
    firstRunMock.passed = false;
    firstRunMock.showProvision = false;
    firstRunMock.snapshot = null;
    firstRunMock.canEnterOffline = true;
    firstRunMock.allowOfflineMain = false;
    postLoginMock.gated = true;
    postLoginMock.canEscape = true;

    const { result } = renderHook(() => useStartupConnectGate(true));
    expect(result.current.active).toBe(true);
    expect(result.current.mode).toBe("connect");
    expect(result.current.canEnterOffline).toBe(true);
    expect(result.current.onEnterOffline).toBe(firstRunMock.enterOffline);
  });

  it("首启离线进入后关闭门闸并保留主界面", () => {
    firstRunMock.active = true;
    firstRunMock.passed = true;
    firstRunMock.showProvision = false;
    firstRunMock.canEnterOffline = false;
    firstRunMock.allowOfflineMain = true;
    postLoginMock.gated = true;
    postLoginMock.canEscape = true;
    postLoginMock.allowOfflineMain = false;

    const { result } = renderHook(() => useStartupConnectGate(true));
    expect(result.current.active).toBe(false);
    expect(result.current.allowOfflineMain).toBe(true);
  });

  it("首启尚未超时不透出离线入口", () => {
    firstRunMock.active = true;
    firstRunMock.passed = false;
    firstRunMock.showProvision = false;
    firstRunMock.snapshot = null;
    firstRunMock.canEnterOffline = false;
    firstRunMock.allowOfflineMain = false;
    postLoginMock.gated = true;
    postLoginMock.canEscape = true;

    const { result } = renderHook(() => useStartupConnectGate(true));
    expect(result.current.active).toBe(true);
    expect(result.current.mode).toBe("connect");
    expect(result.current.canEnterOffline).toBe(false);
  });

  it("首启通过后日常不再挡主界面", () => {
    firstRunMock.active = false;
    firstRunMock.passed = true;
    postLoginMock.gated = false;
    postLoginMock.canEscape = true;

    const { result } = renderHook(() => useStartupConnectGate(true));
    expect(result.current.active).toBe(false);
  });

  it("全部放行时不激活", () => {
    firstRunMock.active = false;
    firstRunMock.passed = true;
    firstRunMock.allowOfflineMain = false;
    postLoginMock.gated = false;
    postLoginMock.allowOfflineMain = false;

    const { result } = renderHook(() => useStartupConnectGate(true));
    expect(result.current.active).toBe(false);
    expect(result.current.label).toBe("");
  });
});
