import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAuthStore } from "./stores/authStore";
import { useGatewayStore } from "./stores/gatewayStore";
import { useLicenseStore } from "./stores/licenseStore";
import * as tauriEnv from "./lib/tauri-env";

vi.mock("./hooks/useOpenClawProvision", () => ({
  useOpenClawProvision: () => ({
    checking: false,
    snapshot: null,
    blocking: false,
    retry: vi.fn(),
  }),
}));

vi.mock("./hooks/useOpenClawEnvSetup", () => ({
  useOpenClawEnvSetup: () => ({
    initialized: true,
    status: null,
    blocking: false,
    checkPending: false,
    busy: false,
    saveKeys: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("./components/auth/LicenseScreen", async () => {
  const { useLicenseStore } = await import("./stores/licenseStore");
  return {
    LicenseScreen: function LicenseScreenMock() {
      const expired = useLicenseStore((s) => s.expired);
      return (
        <div>
          <h1>{expired ? "授权已到期" : "设备授权"}</h1>
        </div>
      );
    },
  };
});

vi.mock("./hooks/useFirstRunGatewayGate", () => ({
  useFirstRunGatewayGate: () => ({
    active: false,
    passed: true,
    showProvision: false,
    snapshot: null,
    connectLabel: "",
    connectError: null,
    retryConnect: vi.fn(),
  }),
}));

vi.mock("./hooks/useFirstReadyHint", () => ({
  useFirstReadyHint: () => undefined,
}));

describe("YunTu Control shell", () => {
  beforeEach(() => {
    vi.spyOn(tauriEnv, "isTauriRuntime").mockReturnValue(false);
    try {
      localStorage.setItem("yuntu.headerNavMode", "expanded");
    } catch {
      /* ignore */
    }
    useLicenseStore.setState({
      licensed: true,
      fingerprint: "",
      message: "",
      expiresAt: null,
      expired: false,
      renewSoon: false,
      daysRemaining: null,
      isInitialized: true,
      initialize: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
    });
    useAuthStore.setState({
      user: null,
      isLoggedIn: false,
      hasAnyUsers: true,
      isInitialized: true,
      initError: null,
    });
    useGatewayStore.setState({ connState: "connected", lastError: null });
  });

  it("shows login screen with brand when not logged in", async () => {
    render(<App />);
    expect(await screen.findByText("YunTu Control")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登 录" })).toBeInTheDocument();
  });

  it("renders main workspace when authenticated", async () => {
    useAuthStore.setState({
      isLoggedIn: true,
      hasAnyUsers: true,
      isInitialized: true,
      initError: null,
      user: {
        id: "u1",
        username: "admin",
        role: "admin",
        createdAt: "0",
        token: "test-token",
      },
    });
    render(<App />);
    expect(
      (await screen.findAllByRole("tab", { name: "对话" }, { timeout: 8000 })).length,
    ).toBeGreaterThan(0);
  }, 10000);

  it("shows license screen when not licensed", async () => {
    useLicenseStore.setState({
      licensed: false,
      isInitialized: true,
      message: "未授权",
      expired: false,
      renewSoon: false,
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "设备授权" })).toBeInTheDocument();
  });

  it("shows expired license gate heading", async () => {
    useLicenseStore.setState({
      licensed: false,
      isInitialized: true,
      expired: true,
      message: "授权已到期",
    });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "授权已到期" })).toBeInTheDocument();
  });
});
