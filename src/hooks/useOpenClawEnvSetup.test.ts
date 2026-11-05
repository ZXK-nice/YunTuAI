import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOpenClawEnvSetup } from "./useOpenClawEnvSetup";

const mocks = vi.hoisted(() => ({
  fetchOpenClawEnvStatus: vi.fn(),
  saveOpenClawEnvKeys: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
}));

vi.mock("../lib/openclaw/env-bridge", () => ({
  fetchOpenClawEnvStatus: mocks.fetchOpenClawEnvStatus,
  saveOpenClawEnvKeys: mocks.saveOpenClawEnvKeys,
}));
vi.mock("../lib/tauri-env", () => ({
  isTauriRuntime: mocks.isTauriRuntime,
}));

const readySnap = {
  bundledManaged: true,
  setupRequired: false,
  apiKeyLocked: false,
  keys: [],
  envPath: "C:\\data\\.env",
};

beforeEach(() => {
  mocks.isTauriRuntime.mockReturnValue(true);
  mocks.fetchOpenClawEnvStatus.mockResolvedValue(readySnap);
});

describe("useOpenClawEnvSetup", () => {
  it("未启用时立即就绪", () => {
    const { result } = renderHook(() => useOpenClawEnvSetup(false));
    expect(result.current.initialized).toBe(true);
    expect(result.current.blocking).toBe(false);
    expect(mocks.fetchOpenClawEnvStatus).not.toHaveBeenCalled();
  });

  it("启用后拉取 env 状态并结束 blocking", async () => {
    const { result } = renderHook(() => useOpenClawEnvSetup(true));
    await waitFor(() => {
      expect(result.current.initialized).toBe(true);
    });
    expect(result.current.blocking).toBe(false);
    expect(mocks.fetchOpenClawEnvStatus).toHaveBeenCalled();
  });

  it("setupRequired 时 blocking 为 true", async () => {
    mocks.fetchOpenClawEnvStatus.mockResolvedValue({
      ...readySnap,
      setupRequired: true,
    });
    const { result } = renderHook(() => useOpenClawEnvSetup(true));
    await waitFor(() => {
      expect(result.current.blocking).toBe(true);
    });
  });
});
