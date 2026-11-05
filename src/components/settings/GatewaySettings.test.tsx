import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GatewaySettings } from "./GatewaySettings";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
}));

vi.mock("../../lib/tauri-env", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("../../stores/gatewayStore", () => ({
  useGatewayStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        connState: "disconnected",
        lastError: null,
        exclusiveReport: null,
        refreshExclusiveReport: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ connState: "disconnected", lastError: null }) },
  ),
}));

vi.mock("../../stores/ownerStore", () => ({
  useOwnerStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = { unlocked: false, devBypass: false, emergencyLoginEnabled: false };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ unlocked: false, devBypass: false }) },
  ),
}));

vi.mock("../../stores/authStore", () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = { isLoggedIn: true, user: { role: "user" } };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ isLoggedIn: true, user: { role: "user" } }) },
  ),
}));

vi.mock("../../stores/uiStore", () => ({
  useUiStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = { showToast: vi.fn(), settingsFocus: null, consumeSettingsFocus: vi.fn() };
      return sel ? sel(state) : state;
    },
    { getState: () => ({
      showToast: vi.fn(),
      settingsFocus: null,
      consumeSettingsFocus: vi.fn(),
    }) },
  ),
}));

vi.mock("../../stores/modelStore", () => ({
  useModelStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = { selectionId: "deepseek-chat" };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ selectionId: "deepseek-chat" }) },
  ),
}));

vi.mock("../../hooks/useConnectionDiagnostics", () => ({
  useConnectionDiagnostics: () => ({ report: null, busy: false, run: vi.fn(), copyDiagnostics: vi.fn() }),
}));

vi.mock("../../lib/openclaw/env-bridge", () => ({
  fetchCurrentModel: async () => "deepseek-chat",
  fetchDistributionProfile: async () => ({
    profile: "internal",
    profileLabel: "内部版",
    defaultModelId: "mimo-v2.5",
  }),
}));

vi.mock("../../lib/openclaw/gateway-tools", () => ({
  fetchGatewayRuntimeConfig: async () => ({ modelId: "deepseek-chat" }),
}));

vi.mock("../../lib/openclaw/data-roots-bridge", () => ({
  fetchOpenClawDataRoots: async () => null,
  switchOpenClawDataRoot: async () => null,
}));

vi.mock("../../lib/openclaw/cli-bridge", () => ({
  cliGatewaySupervisorRestart: vi.fn(),
  cliOpenClawControlAdopt: vi.fn(),
  cliOpenClawControlDiscover: vi.fn(),
  cliOpenClawControlWriteConfig: vi.fn(),
  cliOpenClawControlReadConfig: vi.fn(),
  cliOpenClawMigrateFromLegacy: vi.fn(),
}));

vi.mock("../../lib/connect-with-feedback", () => ({
  connectWithFeedback: vi.fn(),
}));

vi.mock("./AppUpdatePanel", () => ({ AppUpdatePanel: () => null }));
vi.mock("./OpenClawRuntimePanel", () => ({ OpenClawRuntimePanel: () => null }));
vi.mock("./ApiKeySettingsPanel", () => ({ ApiKeySettingsPanel: () => null }));
vi.mock("./AccountPasswordSection", () => ({ AccountPasswordSection: () => null }));
vi.mock("./CapabilityOpsPanel", () => ({ CapabilityOpsPanel: () => null }));
vi.mock("./KbAssistantSettingsPanel", () => ({ KbAssistantSettingsPanel: () => null }));
vi.mock("./ModuleManagerPanel", () => ({ ModuleManagerPanel: () => null }));
vi.mock("./OutputDirSettingsPanel", () => ({ OutputDirSettingsPanel: () => null }));
vi.mock("./RuntimeEnvironmentPanel", () => ({ RuntimeEnvironmentPanel: () => null }));
vi.mock("./SystemAboutPanel", () => ({ SystemAboutPanel: () => null }));
vi.mock("./SoftwareAppearancePanel", () => ({ SoftwareAppearancePanel: () => null }));
vi.mock("./SoftwareStartupPanel", () => ({ SoftwareStartupPanel: () => null }));
vi.mock("./DataPathsPanel", () => ({ DataPathsPanel: () => null }));
vi.mock("./LicenseStatusPanel", () => ({ LicenseStatusPanel: () => null }));
vi.mock("./OpenClawDataRootsBanner", () => ({ OpenClawDataRootsBanner: () => null }));
vi.mock("./GatewaySupervisorPanel", () => ({ GatewaySupervisorPanel: () => null }));
vi.mock("./GatewayConnectionSettings", () => ({ GatewayConnectionSettings: () => null }));
vi.mock("./GatewayConfigReadoutPanel", () => ({ GatewayConfigReadoutPanel: () => null }));
vi.mock("./OpenClawOwnerDevSettings", () => ({ OpenClawOwnerDevSettings: () => null }));
vi.mock("../openclaw/GatewayServiceControls", () => ({ GatewayServiceControls: () => null }));
vi.mock("../owner/OwnerUnlockPanel", () => ({ OwnerUnlockPanel: () => null }));

describe("GatewaySettings smoke", () => {
  it("renders settings navigation", () => {
    render(<GatewaySettings />);
    expect(screen.getByLabelText("设置分类")).toBeTruthy();
    expect(screen.getByText("模型密钥")).toBeTruthy();
    expect(screen.getByText("本机服务")).toBeTruthy();
  });
});
