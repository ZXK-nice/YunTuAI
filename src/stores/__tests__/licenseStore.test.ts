import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useLicenseStore } from "../licenseStore";
import * as tauriEnv from "../../lib/tauri-env";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("licenseStore", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(tauriEnv, "isTauriRuntime").mockReturnValue(true);
    useLicenseStore.setState({
      licensed: false,
      fingerprint: "",
      message: "",
      expiresAt: null,
      expired: false,
      renewSoon: false,
      daysRemaining: null,
      isInitialized: false,
    });
  });

  it("initialize applies full license status including expiry", async () => {
    vi.mocked(invoke).mockResolvedValue({
      licensed: true,
      fingerprint: "f".repeat(64),
      message: "ok",
      expiresAt: "2026-08-01T00:00:00Z",
      expired: false,
      renewSoon: true,
      daysRemaining: 2,
    });

    await useLicenseStore.getState().initialize();

    const s = useLicenseStore.getState();
    expect(s.isInitialized).toBe(true);
    expect(s.licensed).toBe(true);
    expect(s.renewSoon).toBe(true);
    expect(s.daysRemaining).toBe(2);
    expect(s.expiresAt).toBe("2026-08-01T00:00:00Z");
  });

  it("install throws when backend returns unlicensed", async () => {
    vi.mocked(invoke).mockResolvedValue({
      licensed: false,
      fingerprint: "f".repeat(64),
      message: "签名无效",
    });

    await expect(useLicenseStore.getState().install("{}")).rejects.toThrow(/签名无效/);
    expect(useLicenseStore.getState().licensed).toBe(false);
  });

  it("install syncs expiry fields on success", async () => {
    vi.mocked(invoke).mockResolvedValue({
      licensed: true,
      fingerprint: "f".repeat(64),
      message: "已授权",
      expiresAt: "2026-09-01T00:00:00Z",
      expired: false,
      renewSoon: false,
      daysRemaining: 30,
    });

    await useLicenseStore.getState().install('{"fingerprint":"x","signature":"y"}');

    const s = useLicenseStore.getState();
    expect(s.licensed).toBe(true);
    expect(s.daysRemaining).toBe(30);
    expect(s.expiresAt).toBe("2026-09-01T00:00:00Z");
  });

  it("refresh keeps state on invoke failure", async () => {
    useLicenseStore.setState({
      licensed: true,
      fingerprint: "abc",
      message: "stable",
      isInitialized: true,
    });
    vi.mocked(invoke).mockRejectedValue(new Error("ipc fail"));

    await useLicenseStore.getState().refresh();

    expect(useLicenseStore.getState().licensed).toBe(true);
    expect(useLicenseStore.getState().message).toBe("stable");
  });
});
