import {
  connectWithFeedback,
  ensureBackgroundConnecting,
  wireDesktopConnectInFlight,
} from "../connect-with-feedback";
import { isFirstRunGatewayPending } from "../first-run-gateway";
import { useGatewayStore } from "../../stores/gatewayStore";
import { waitForEstablishComplete } from "./gateway-lifecycle";
import { isSupervisorGatewayOperational } from "./connection-resilience";
import { prepareConnectGateThenDesktopConnect } from "./connect-gate-prep";
import { getLaunchConnectProfile } from "./launch-connect-profile";
import { isTauriRuntime } from "../tauri-env";
import {
  FIRST_RUN_CONNECT_MAX_MS,
  runStartupConnectPipeline,
} from "./startup-connect-pipeline";

export type DesktopConnectOptions = {
  maxMs?: number;
  cancelled?: () => boolean;
  /** 强制走 connectWithFeedback，跳过首启长超时管线 */
  direct?: boolean;
  context?: string;
  skipPrepare?: boolean;
  forceRepair?: boolean;
  fastReopen?: boolean;
  /** connect-gate-prep 已等待 establish 时跳过二次长等 */
  skipEstablishWait?: boolean;
};

let connectPipelinePromise: Promise<boolean> | null = null;
let desktopWireRegistered = false;

function ensureDesktopWireRegistered(): void {
  if (desktopWireRegistered) return;
  desktopWireRegistered = true;
  wireDesktopConnectInFlight(() => connectPipelinePromise);
}

/**
 * 桌面端连接本机网关的统一入口：首启走 startup 管线，其余走 connectWithFeedback。
 * 全局单飞，避免 bootstrap / 首启门闸 / skipToMain 并行 prepare+connect。
 */
export function requestDesktopConnect(opts?: DesktopConnectOptions): Promise<boolean> {
  ensureDesktopWireRegistered();
  if (connectPipelinePromise) {
    return connectPipelinePromise;
  }

  connectPipelinePromise = (async () => {
    const initial = useGatewayStore.getState();
    if (initial.connState === "connected") {
      if (initial.startupPhase) {
        useGatewayStore.setState({ startupPhase: null, lastError: null });
      }
      return true;
    }

    ensureBackgroundConnecting();

    const cancelled = opts?.cancelled ?? (() => false);
    const profile = getLaunchConnectProfile();

    if (isTauriRuntime() && !opts?.skipEstablishWait) {
      const report = useGatewayStore.getState().exclusiveReport;
      const warm =
        opts?.fastReopen ||
        (isSupervisorGatewayOperational(report?.supervisor ?? null) &&
          !report?.externalGatewayConflict);
      await waitForEstablishComplete({
        maxMs: warm
          ? Math.min(profile.gatewayReadyMaxMs, 4_000)
          : profile.postLoginGatewayWaitMs,
      });
    }

    const useFirstRunPipeline = !opts?.direct && isFirstRunGatewayPending();

    if (useFirstRunPipeline) {
      return runStartupConnectPipeline({
        maxMs: opts?.maxMs ?? FIRST_RUN_CONNECT_MAX_MS,
        cancelled,
      });
    }

    return connectWithFeedback(opts?.context, {
      skipPrepare: opts?.skipPrepare,
      forceRepair: opts?.forceRepair,
      fastReopen: opts?.fastReopen,
      maxMs: opts?.maxMs,
      cancelled,
      coalesceDesktop: false,
    });
  })().finally(() => {
    connectPipelinePromise = null;
  });

  return connectPipelinePromise;
}

export function isDesktopConnectInFlight(): boolean {
  return connectPipelinePromise != null;
}

/** 登录后 AppShell bootstrap：非首启门闸场景下的标准连接 */
export async function runPostLoginDesktopConnect(cancelled: () => boolean): Promise<void> {
  if (cancelled()) return;
  if (isFirstRunGatewayPending() && useGatewayStore.getState().connState !== "connected") {
    return;
  }
  if (useGatewayStore.getState().connState === "connected") {
    useGatewayStore.setState({ startupPhase: null, lastError: null });
    return;
  }

  await useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);

  const profile = getLaunchConnectProfile();
  await prepareConnectGateThenDesktopConnect(profile, {
    context: "重新打开连接本机服务",
    cancelled,
  });
}
