import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("../../lib/tauri-env", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("../../lib/async-utils", () => ({
  withTimeout: (p: Promise<unknown>) => p,
}));

describe("authStore", () => {
  beforeEach(() => {
    vi.resetModules();
    invokeMock.mockReset();
    localStorage.clear();
  });

  it("login stores user and encrypted token on success", async () => {
    invokeMock.mockResolvedValueOnce({
      id: "u1",
      username: "alice",
      role: "user",
      createdAt: "now",
      token: "enc-token",
    });
    const { useAuthStore } = await import("../authStore");
    await useAuthStore.getState().login("alice", "pass1234");
    expect(useAuthStore.getState().isLoggedIn).toBe(true);
    expect(useAuthStore.getState().user?.username).toBe("alice");
  });

  it("dev build auto-logs in without showing login", async () => {
    invokeMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce({
        id: "dev1",
        username: "dev",
        role: "admin",
        createdAt: "now",
        token: "dev-token",
      });
    const { useAuthStore } = await import("../authStore");
    await useAuthStore.getState().initialize();
    expect(invokeMock).toHaveBeenCalledWith("auth_dev_skip_login");
    expect(invokeMock).toHaveBeenCalledWith("auth_dev_auto_login");
    expect(useAuthStore.getState().isLoggedIn).toBe(true);
    expect(useAuthStore.getState().user?.username).toBe("dev");
    expect(useAuthStore.getState().initError).toBeNull();
  });

  it("logout clears session state", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { useAuthStore } = await import("../authStore");
    useAuthStore.setState({
      user: { id: "u1", username: "a", role: "user", createdAt: "", token: "t" },
      isLoggedIn: true,
    });
    await useAuthStore.getState().logout();
    expect(useAuthStore.getState().isLoggedIn).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
