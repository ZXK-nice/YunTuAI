import { describe, expect, it, vi, beforeEach } from "vitest";
import { shouldUseFullScreenConnectGate, connectGateEscapeMs } from "./connect-gate-policy";

const mocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => true),
}));

vi.mock("../tauri-env", () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}));

beforeEach(() => {
  mocks.isTauriRuntime.mockReturnValue(true);
});

describe("connect-gate-policy", () => {
  it("桌面端始终使用全屏连接门", () => {
    expect(shouldUseFullScreenConnectGate()).toBe(true);
  });

  it("非 Tauri 不启用全屏门", () => {
    mocks.isTauriRuntime.mockReturnValue(false);
    expect(shouldUseFullScreenConnectGate()).toBe(false);
  });

  it("不提供离线进入超时", () => {
    expect(connectGateEscapeMs()).toBe(Number.POSITIVE_INFINITY);
  });
});
