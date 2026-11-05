import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("invokeWithAuthRetry", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    localStorage.clear();
  });

  it("retries once after refreshing session on auth errors", async () => {
    localStorage.setItem("yuntuai_auth_token", "saved-token");

    invokeMock
      .mockRejectedValueOnce(new Error("会话已过期，请重新登录"))
      .mockResolvedValueOnce({ id: "u1", username: "demo", role: "user", token: "fresh-token" })
      .mockResolvedValueOnce([{ id: "s1" }]);

    const { useAuthStore } = await import("../stores/authStore");
    useAuthStore.setState({ user: null, isLoggedIn: false });

    const { invokeWithAuthRetry } = await import("./auth-token");
    const rows = await invokeWithAuthRetry<Array<{ id: string }>>("db_list_sessions", {});

    expect(rows).toEqual([{ id: "s1" }]);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({ token: "saved-token" });
    expect(invokeMock.mock.calls[2]?.[1]).toMatchObject({ token: "fresh-token" });
    expect(useAuthStore.getState().isLoggedIn).toBe(true);
  });

  it("rethrows non-auth errors without retry", async () => {
    localStorage.setItem("yuntuai_auth_token", "saved-token");
    invokeMock.mockRejectedValueOnce(new Error("磁盘已满"));

    const { invokeWithAuthRetry } = await import("./auth-token");
    await expect(invokeWithAuthRetry("db_list_sessions", {})).rejects.toThrow("磁盘已满");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe("invokeAuthed", () => {
  it("throws DesktopOnlyError outside Tauri runtime", async () => {
    const { invokeAuthed, DesktopOnlyError } = await import("./tauri-invoke");
    await expect(invokeAuthed("audit_list", { limit: 1 })).rejects.toBeInstanceOf(DesktopOnlyError);
  });
});
