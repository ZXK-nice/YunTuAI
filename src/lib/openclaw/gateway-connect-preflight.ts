/**
 * 连接前统一准备：压制外部 openclaw → 冲突时回收监管权 → 否则 repair → 刷新凭据。
 * 所有用户可见「连接/重连」路径应经此模块或 connectWithFeedback。
 */
import { isTauriRuntime } from "../tauri-env";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import {
  cliGatewaySupervisorStatus,
  cliOpenClawExclusiveReport,
  cliStopAllGateways,
  cliSuppressExternalOpenClaw,
} from "./cli-bridge";
import { repairGatewayConnection } from "./repair-gateway-connection";
import { isSupervisorGatewayOperational } from "./connection-resilience";
import { isInStartupGrace } from "./gateway-recovery";
import { getLaunchConnectProfile } from "./launch-connect-profile";
import { ensureGatewayServiceReady, fetchGatewayLifecycleSnapshot, shouldSkipHeavyGatewayPrep, waitForEstablishComplete } from "./gateway-lifecycle";
import {
  fetchProvisionStatus,
  switchRuntimePreference,
} from "./provision-bridge";
import { withTimeout } from "../async-utils";
import {
  GATEWAY_PREPARE_MAX_MS,
  GATEWAY_RECOVERY_TIMEOUT_MS,
} from "./gateway-recovery-policy";
import { gatewayConnectFlight } from "../../stores/gateway-store-connect-flight";
import { EXCLUSIVE_REPORT_MIN_INTERVAL_MS } from "../../stores/gateway-store-constants";
import type { OpenClawExclusiveReport } from "./cli-bridge";

export type PrepareGatewayOptions = {
  /** 忽略冷却与「已连接」短路，强制执行完整准备 */
  force?: boolean;
};

let prepareInFlight: Promise<void> | null = null;
let prepareEpoch = 0;
let lastPrepareFinishedAt = 0;
let autoBundledSwitchAttempted = false;

const PREPARE_COOLDOWN_MS = 2_500;
const PREPARE_MAX_MS = GATEWAY_PREPARE_MAX_MS;

async function loadExclusiveReportCached(force?: boolean): Promise<OpenClawExclusiveReport | null> {
  const gs = useGatewayStore.getState();
  const now = Date.now();
  if (
    !force &&
    gs.exclusiveReport &&
    now - gatewayConnectFlight.lastExclusiveFetchAt < EXCLUSIVE_REPORT_MIN_INTERVAL_MS
  ) {
    return gs.exclusiveReport;
  }
  const report = await cliOpenClawExclusiveReport().catch(() => null);
  if (report) {
    gatewayConnectFlight.lastExclusiveFetchAt = Date.now();
    gs.applyExclusiveReport(report);
  }
  return report;
}

/** WebSocket 握手或已连接时跳过 prepare，避免停启网关打断进行中的 connect。 */
async function abortPrepareIfAlreadyConnected(force?: boolean): Promise<boolean> {
  if (force) return false;
  const gs = useGatewayStore.getState();
  if (gs.connState !== "connected") return false;
  const st = await cliGatewaySupervisorStatus().catch(() => null);
  if (!isSupervisorGatewayOperational(st)) return false;
  const report = await loadExclusiveReportCached();
  if (report?.externalGatewayConflict) return false;
  await gs.loadGatewayPrefs();
  return true;
}

async function runPrepareBody(force?: boolean, stale?: () => boolean): Promise<void> {
  const abandoned = () => stale?.() === true;
  if (abandoned()) return;
  if (await abortPrepareIfAlreadyConnected(force)) return;

  const profile = getLaunchConnectProfile();
  await waitForEstablishComplete({ maxMs: profile.postLoginGatewayWaitMs });
  if (await abortPrepareIfAlreadyConnected(force)) return;

  let lifecycleSnap = await fetchGatewayLifecycleSnapshot();
  if (!force && shouldSkipHeavyGatewayPrep(lifecycleSnap)) {
    await useGatewayStore.getState().loadGatewayPrefs().catch(() => undefined);
    return;
  }

  const quick = await cliGatewaySupervisorStatus().catch(() => null);
  if (isSupervisorGatewayOperational(quick)) {
    const report = await loadExclusiveReportCached();
    if (!report?.externalGatewayConflict) {
      await useGatewayStore.getState().loadGatewayPrefs();
      return;
    }
  }

  if (abandoned() || (await abortPrepareIfAlreadyConnected(force))) return;

  await cliSuppressExternalOpenClaw().catch(() => null);

  if (abandoned() || (await abortPrepareIfAlreadyConnected(force))) return;

  const report = await loadExclusiveReportCached();

  let conflict =
    report?.externalGatewayConflict ??
    useGatewayStore.getState().exclusiveReport?.externalGatewayConflict;

  if (!autoBundledSwitchAttempted && !isInStartupGrace()) {
    const snap = await fetchProvisionStatus().catch(() => null);
    if (await abortPrepareIfAlreadyConnected(force)) return;
    if (snap?.runtimeSource && snap.runtimeSource !== "bundled" && snap.bundledInstallAvailable) {
      autoBundledSwitchAttempted = true;
      try {
        await switchRuntimePreference("bundled");
        useUiStore
          .getState()
          .showToast("已切换为内置版，连接更稳定", "info");
        await cliSuppressExternalOpenClaw().catch(() => null);
        const { autoRecoverSupervisorGateway } = await import("./auto-supervisor-recovery");
        await autoRecoverSupervisorGateway({ force: true }).catch(() => false);
        const after = await loadExclusiveReportCached(true);
        conflict = after?.externalGatewayConflict ?? conflict;
      } catch {
        /* 切换失败时继续走 reclaim/repair */
      }
    }
  }

  if (abandoned() || (await abortPrepareIfAlreadyConnected(force))) return;

  if (conflict) {
    const snapBeforeStop = await fetchGatewayLifecycleSnapshot();
    if (!shouldSkipHeavyGatewayPrep(snapBeforeStop) || force) {
      await cliStopAllGateways().catch(() => null);
    }
    await useGatewayStore.getState().reclaimExclusive();
  } else {
    const repaired = await repairGatewayConnection({ waitMs: 800 });
    if (!repaired) {
      const snap = await fetchGatewayLifecycleSnapshot();
      if (!shouldSkipHeavyGatewayPrep(snap)) {
        await ensureGatewayServiceReady({ maxWaitMs: GATEWAY_RECOVERY_TIMEOUT_MS }).catch(() => false);
      }
    }
  }

  if (await abortPrepareIfAlreadyConnected(force)) return;

  const status = useGatewayStore.getState().exclusiveReport?.supervisor;
  if (!isSupervisorGatewayOperational(status ?? null)) {
    const snap = await fetchGatewayLifecycleSnapshot();
    if (!shouldSkipHeavyGatewayPrep(snap)) {
      await ensureGatewayServiceReady({ maxWaitMs: GATEWAY_RECOVERY_TIMEOUT_MS }).catch(() => false);
    }
  }

  await useGatewayStore.getState().loadGatewayPrefs();
}

export async function prepareGatewayForConnect(
  opts?: PrepareGatewayOptions,
): Promise<void> {
  if (!isTauriRuntime()) return;

  if (!opts?.force) {
    if (await abortPrepareIfAlreadyConnected(false)) return;

    const gs = useGatewayStore.getState();
    const operational = isSupervisorGatewayOperational(
      gs.exclusiveReport?.supervisor ?? null,
    );
    if (
      gs.connState === "connected" &&
      operational &&
      !gs.exclusiveReport?.externalGatewayConflict
    ) {
      await gs.loadGatewayPrefs();
      return;
    }

    const since = Date.now() - lastPrepareFinishedAt;
    if (!opts?.force && since < PREPARE_COOLDOWN_MS) {
      return;
    }
  }

  if (prepareInFlight) {
    await prepareInFlight.catch(() => undefined);
    if (!opts?.force) return;
  }

  prepareInFlight = (async () => {
    const epoch = ++prepareEpoch;
    try {
      await withTimeout(
        runPrepareBody(opts?.force, () => epoch !== prepareEpoch),
        PREPARE_MAX_MS,
        "prepareGateway",
      );
      if (epoch === prepareEpoch) lastPrepareFinishedAt = Date.now();
    } catch (e) {
      if (epoch === prepareEpoch) prepareEpoch += 1;
      throw e;
    }
  })();

  try {
    await prepareInFlight;
  } finally {
    prepareInFlight = null;
  }
}
