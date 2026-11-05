import { describe, expect, it } from "vitest";
import {
  __resetLaunchConnectProfileForTest,
  applyLaunchConnectProfile,
  getLaunchConnectProfile,
  tuneConnectBudgetForBuild,
} from "./launch-connect-profile";

describe("launch-connect-profile", () => {
  it("uses longer budgets on fresh boot", () => {
    __resetLaunchConnectProfileForTest();
    applyLaunchConnectProfile({
      trayMode: true,
      freshSystemBoot: true,
      legacyStartupBat: false,
      startupGraceMs: 180_000,
    });
    const profile = getLaunchConnectProfile();
    expect(profile.gatewayReadyMaxMs).toBe(tuneConnectBudgetForBuild(60_000));
    expect(profile.startupConnectMaxMs).toBe(tuneConnectBudgetForBuild(120_000));
    expect(profile.postLoginGatewayWaitMs).toBe(tuneConnectBudgetForBuild(55_000));
  });

  it("uses moderate budgets for tray-only reopen", () => {
    __resetLaunchConnectProfileForTest();
    applyLaunchConnectProfile({
      trayMode: true,
      freshSystemBoot: false,
      legacyStartupBat: false,
      startupGraceMs: 120_000,
    });
    const profile = getLaunchConnectProfile();
    expect(profile.gatewayReadyMaxMs).toBe(tuneConnectBudgetForBuild(32_000));
    expect(profile.startupConnectMaxMs).toBe(tuneConnectBudgetForBuild(75_000));
  });
});
