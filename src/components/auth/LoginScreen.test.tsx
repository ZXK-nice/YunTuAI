import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";

const authState = {
  isInitialized: true,
  hasAnyUsers: true,
  registrationAllowed: false,
  accountDataLost: false,
  recoveryUsernames: [] as string[],
  initError: null,
  isLoggedIn: false,
  login: vi.fn(),
  register: vi.fn(),
  ownerEmergencyLogin: vi.fn(),
};

vi.mock("../../stores/authStore", () => ({
  useAuthStore: Object.assign(
    (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
    { getState: () => authState, setState: vi.fn() },
  ),
}));

vi.mock("../../stores/ownerStore", () => ({
  useOwnerStore: Object.assign(
    (sel?: (s: { emergencyLoginEnabled: boolean }) => unknown) =>
      sel ? sel({ emergencyLoginEnabled: false }) : { emergencyLoginEnabled: false },
    { getState: () => ({ emergencyLoginEnabled: false }) },
  ),
}));

vi.mock("../../hooks/useAppLogo", () => ({
  useAppLogo: () => "/logo.png",
}));

vi.mock("../../lib/openclaw/env-bridge", () => ({
  fetchDistributionProfile: async () => ({
    profile: "internal",
    profileLabel: "内部版",
    defaultModelId: "mimo-v2.5",
  }),
}));

vi.mock("../../lib/tauri-env", () => ({
  isTauriRuntime: () => true,
}));

describe("LoginScreen smoke", () => {
  it("renders login form fields", () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText("用户名")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: /登\s*录/i })).toBeTruthy();
  });

  it("treats empty account db as recoverable Owner login", async () => {
    authState.hasAnyUsers = false;
    authState.accountDataLost = true;
    authState.registrationAllowed = false;
    render(<LoginScreen />);
    expect(await screen.findByText(/不是软件损坏/)).toBeTruthy();
    expect(await screen.findByLabelText("Owner 密码")).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText("用户名") as HTMLInputElement).value).toBe("admin");
    });
    authState.hasAnyUsers = true;
    authState.accountDataLost = false;
  });
});
