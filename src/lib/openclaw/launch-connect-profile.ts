/**
 * 根据启动上下文（开机/托盘自启）动态调整网关等待与连接预算。
 * 避免固定 12s/30s 在登录自启场景下必然失败。
 */
import type { LaunchContext } from "../app-launch-bridge";

export type LaunchConnectProfile = {
  freshSystemBoot: boolean;
  trayMode: boolean;
  gatewayReadyMaxMs: number;
  startupConnectMaxMs: number;
  postLoginGatewayWaitMs: number;
  connectReadyWaitMs: number;
  wakeProbeCooldownMs: number;
};

const DEFAULT_PROFILE: LaunchConnectProfile = {
  freshSystemBoot: false,
  trayMode: false,
  // 112 等客户机冷启动网关常需 30–60s；过短预算会误报「未连接」并反复拉起 node。
  gatewayReadyMaxMs: 25_000,
  startupConnectMaxMs: 60_000,
  postLoginGatewayWaitMs: 45_000,
  connectReadyWaitMs: 20_000,
  wakeProbeCooldownMs: 8_000,
};

let activeProfile: LaunchConnectProfile = DEFAULT_PROFILE;

const IS_DEV_BUILD = import.meta.env.DEV;

/** 开发版缩短连接预算；正式包保持客户机冷启动容错。 */
export function tuneConnectBudgetForBuild(ms: number): number {
  if (!IS_DEV_BUILD) return ms;
  return Math.max(8_000, Math.round(ms * 0.45));
}

function tuneForBuild(ms: number): number {
  return tuneConnectBudgetForBuild(ms);
}

export function applyLaunchConnectProfile(ctx: LaunchContext | null): LaunchConnectProfile {
  const freshSystemBoot = ctx?.freshSystemBoot ?? false;
  const trayMode = ctx?.trayMode ?? false;

  activeProfile = {
    freshSystemBoot,
    trayMode,
    gatewayReadyMaxMs: tuneForBuild(
      freshSystemBoot ? 60_000 : trayMode ? 32_000 : 25_000,
    ),
    startupConnectMaxMs: tuneForBuild(
      freshSystemBoot ? 120_000 : trayMode ? 75_000 : 60_000,
    ),
    postLoginGatewayWaitMs: tuneForBuild(
      freshSystemBoot ? 55_000 : trayMode ? 36_000 : 45_000,
    ),
    connectReadyWaitMs: tuneForBuild(
      freshSystemBoot ? 45_000 : trayMode ? 28_000 : 20_000,
    ),
    wakeProbeCooldownMs: freshSystemBoot ? 12_000 : 8_000,
  };
  return activeProfile;
}

/** 连接门「先进入界面」出口：开发版更快放行。 */
export function getConnectGateEscapeMs(): number {
  return IS_DEV_BUILD ? 12_000 : 30_000;
}

export function getLaunchConnectProfile(): LaunchConnectProfile {
  return activeProfile;
}

export function __resetLaunchConnectProfileForTest(): void {
  activeProfile = DEFAULT_PROFILE;
}
