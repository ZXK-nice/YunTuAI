/**
 * 登录门闸 / 二次打开：在稳定前提下缩短「网关已就绪」场景的等待预算。
 */
import { useGatewayStore } from "../../stores/gatewayStore";
import { isSupervisorGatewayOperational } from "./connection-resilience";
import { humanizeConnectError } from "./connect-error-copy";
import { ensureBackgroundConnecting } from "../connect-with-feedback";
import {
  ensureGatewayServiceReady,
  fetchGatewayLifecycleSnapshot,
  lifecycleLooksConnectable,
  waitForEstablishComplete,
} from "./gateway-lifecycle";
import { waitForGatewayReady } from "./gateway-ready-wait";
import type { LaunchConnectProfile } from "./launch-connect-profile";
import { REOPEN_CONNECT_MAX_MS } from "./startup-connect-pipeline";
import {
  requestDesktopConnect,
  type DesktopConnectOptions,
} from "./desktop-connect-scheduler";

/** 监管网关已在跑时，establish 收尾短等上限 */
const WARM_ESTABLISH_CAP_MS = 4_000;
/** 暖启动：端口已监听时的就绪短等 */
const WARM_GATEWAY_READY_CAP_MS = 5_000;

/** 避免 bootstrap 与 post-login 门闸并行跑两遍 establish/ensure，开发版尤其容易卡整窗。 */
let connectGatePrepPromise: Promise<boolean> | null = null;

export type ConnectGatePrepResult = {
  fastReopen: boolean;
};

/** 网关已明确启动失败时立即报错，避免连接门傻等 30–60s 超时。 */
export async function abortGatewayStartupFailureIfAny(): Promise<boolean> {
  const snap = await fetchGatewayLifecycleSnapshot().catch(() => null);
  if (!snap || snap.phase !== "failed") return false;
  const raw =
    snap.supervisor?.message?.trim() ||
    snap.detail?.trim() ||
    "本机服务启动失败，请到「软件设置 → 本机服务」排查。";
  useGatewayStore.setState({
    connState: "error",
    lastError: humanizeConnectError(raw),
    startupPhase: null,
  });
  return true;
}

function readSupervisorReady(
  report: ReturnType<typeof useGatewayStore.getState>["exclusiveReport"],
  snap: Awaited<ReturnType<typeof fetchGatewayLifecycleSnapshot>>,
): boolean {
  return (
    isSupervisorGatewayOperational(report?.supervisor ?? null) ||
    Boolean(snap && lifecycleLooksConnectable(snap))
  );
}

/** 连接门前：按冷/暖启动分支等待 establish 与网关就绪（避免重复长等）。 */
export async function prepareGatewayForConnectGate(
  profile: LaunchConnectProfile,
): Promise<ConnectGatePrepResult> {
  await useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);
  let snap = await fetchGatewayLifecycleSnapshot().catch(() => null);
  let report = useGatewayStore.getState().exclusiveReport;
  let supervisorReady = readSupervisorReady(report, snap);
  const externalConflict = Boolean(
    report?.externalGatewayConflict ?? snap?.externalConflict,
  );
  const warmStart = supervisorReady && !externalConflict;

  if (warmStart) {
    await waitForEstablishComplete({ maxMs: WARM_ESTABLISH_CAP_MS });
    await waitForGatewayReady({ maxMs: WARM_GATEWAY_READY_CAP_MS }).catch(() => undefined);
  } else {
    await waitForEstablishComplete({ maxMs: profile.postLoginGatewayWaitMs });
    if (!supervisorReady) {
      await ensureGatewayServiceReady({ maxWaitMs: profile.postLoginGatewayWaitMs }).catch(
        () => false,
      );
      await waitForGatewayReady({ maxMs: profile.postLoginGatewayWaitMs }).catch(() => undefined);
      if (await abortGatewayStartupFailureIfAny()) {
        return { fastReopen: false };
      }
      await useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);
      snap = await fetchGatewayLifecycleSnapshot().catch(() => null);
      report = useGatewayStore.getState().exclusiveReport;
      supervisorReady = readSupervisorReady(report, snap);
    } else {
      await waitForGatewayReady({
        maxMs: Math.min(profile.gatewayReadyMaxMs, 3_000),
      }).catch(() => undefined);
    }
  }

  report = useGatewayStore.getState().exclusiveReport;
  const fastReopen = readSupervisorReady(report, snap) && !report?.externalGatewayConflict;
  return { fastReopen };
}

export async function prepareConnectGateThenDesktopConnect(
  profile: LaunchConnectProfile,
  connectOpts?: Pick<DesktopConnectOptions, "context" | "cancelled">,
): Promise<boolean> {
  if (connectGatePrepPromise) {
    return connectGatePrepPromise;
  }

  connectGatePrepPromise = (async () => {
    ensureBackgroundConnecting();
    if (await abortGatewayStartupFailureIfAny()) return false;
    const { fastReopen } = await prepareGatewayForConnectGate(profile);
    if (await abortGatewayStartupFailureIfAny()) return false;
    return requestDesktopConnect({
      maxMs: fastReopen ? REOPEN_CONNECT_MAX_MS : profile.startupConnectMaxMs,
      direct: true,
      skipPrepare: fastReopen,
      fastReopen,
      skipEstablishWait: true,
      context: connectOpts?.context ?? (fastReopen ? "重新打开快速连接" : "连接本机服务"),
      cancelled: connectOpts?.cancelled,
    });
  })().finally(() => {
    connectGatePrepPromise = null;
  });

  return connectGatePrepPromise;
}

/** 单测重置 */
export function __resetConnectGatePrepForTest(): void {
  connectGatePrepPromise = null;
}
