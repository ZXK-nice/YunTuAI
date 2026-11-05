import { describe, expect, it } from "vitest";
import { resolveStartupShellPhase } from "./startup-shell-phase";

const base = {
  ready: true,
  licenseReady: true,
  licensed: true,
  isLoggedIn: true,
  envSetupReady: true,
  envCheckPending: false,
  envBlocking: false,
  apiKeyErrorFromGate: false,
  hasEnvStatus: true,
  startupConnectActive: false,
  connConnected: true,
  isTauri: true,
};

describe("resolveStartupShellPhase", () => {
  it("未初始化时停留在 preparing", () => {
    expect(resolveStartupShellPhase({ ...base, ready: false })).toBe("preparing");
    expect(resolveStartupShellPhase({ ...base, licenseReady: false })).toBe("preparing");
  });

  it("未授权进入 license", () => {
    expect(resolveStartupShellPhase({ ...base, licensed: false })).toBe("license");
  });

  it("未登录进入 login", () => {
    expect(resolveStartupShellPhase({ ...base, isLoggedIn: false })).toBe("login");
  });

  it("env 检查中合并到 preparing", () => {
    expect(resolveStartupShellPhase({ ...base, envCheckPending: true })).toBe("preparing");
    expect(resolveStartupShellPhase({ ...base, envSetupReady: false })).toBe("preparing");
  });

  it("需要配置 API Key", () => {
    expect(
      resolveStartupShellPhase({ ...base, envBlocking: true, hasEnvStatus: true }),
    ).toBe("api_key");
  });

  it("缺 API Key 时不得因连接门进入 preparing（避免无网关死等）", () => {
    expect(
      resolveStartupShellPhase({
        ...base,
        envBlocking: true,
        hasEnvStatus: true,
        startupConnectActive: true,
      }),
    ).toBe("api_key");
  });

  it("连接门激活时停留在 preparing", () => {
    expect(resolveStartupShellPhase({ ...base, startupConnectActive: true })).toBe("preparing");
  });

  it("日常未连接也可进入 main", () => {
    expect(resolveStartupShellPhase({ ...base, connConnected: false })).toBe("main");
  });

  it("离线进入或已进过主界面时，未连接也保持 main", () => {
    expect(
      resolveStartupShellPhase({
        ...base,
        connConnected: false,
        startupConnectActive: true,
        allowOfflineMain: true,
      }),
    ).toBe("main");
  });

  it("已连接后进入 main", () => {
    expect(resolveStartupShellPhase(base)).toBe("main");
  });
});
