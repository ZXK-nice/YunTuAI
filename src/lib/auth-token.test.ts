import { describe, expect, it, beforeEach, vi } from "vitest";
import { setEncryptedItem } from "./safeStorage";
import {
  isAuthSessionError,
  readPersistedAuthToken,
  requireAuthToken,
} from "./auth-token";

describe("isAuthSessionError", () => {
  it("detects session-related errors", () => {
    expect(isAuthSessionError("会话无效，请重新登录")).toBe(true);
    expect(isAuthSessionError("会话已过期，请重新登录")).toBe(true);
    expect(isAuthSessionError("未登录")).toBe(true);
    expect(isAuthSessionError("网络超时")).toBe(false);
  });
});

describe("readPersistedAuthToken", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns trimmed token from encrypted storage", () => {
    setEncryptedItem("yuntuai_auth_token", "  abc  ");
    expect(readPersistedAuthToken()).toBe("abc");
  });

  it("returns null when missing or blank", () => {
    expect(readPersistedAuthToken()).toBeNull();
    setEncryptedItem("yuntuai_auth_token", "   ");
    expect(readPersistedAuthToken()).toBeNull();
  });
});

describe("requireAuthToken", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("throws when no token in memory or disk", async () => {
    const { useAuthStore } = await import("../stores/authStore");
    useAuthStore.setState({ user: null, isLoggedIn: false });
    expect(() => requireAuthToken()).toThrow("未登录");
  });

  it("reads from localStorage when memory is empty", async () => {
    const { useAuthStore } = await import("../stores/authStore");
    useAuthStore.setState({ user: null, isLoggedIn: false });
    setEncryptedItem("yuntuai_auth_token", "disk-token");
    expect(requireAuthToken()).toBe("disk-token");
  });
});
