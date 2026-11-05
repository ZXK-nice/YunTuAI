import { PRODUCT_NAME } from "./product-brand";
import { useGatewayStore, awaitGatewayConnectSettled } from "../stores/gatewayStore";
import { isTauriRuntime } from "./tauri-env";
import { prepareGatewayForConnect } from "./openclaw/gateway-connect-preflight";
import { repairGatewayConnection } from "./openclaw/repair-gateway-connection";
import { autoRecoverSupervisorGateway } from "./openclaw/auto-supervisor-recovery";
import { waitForGatewayReady } from "./openclaw/gateway-ready-wait";
import { fetchGatewayLifecycleSnapshot, shouldSkipHeavyGatewayPrep } from "./openclaw/gateway-lifecycle";
import { getLaunchConnectProfile } from "./openclaw/launch-connect-profile";
import { isSupervisorGatewayOperational, sleepMs } from "./openclaw/connection-resilience";
import { hasGatewayEverConnected } from "./first-run-gateway";
import { withTimeout } from "./async-utils";

/** 与 startup-connect-pipeline 中 REOPEN_CONNECT_MAX_MS 保持一致 */
const REOPEN_CONNECT_MAX_MS = 28_000;

/** 仅在这些场景做「停网关 + 强制 prepare」，避免普通「重连」把界面卡死。 */
const HEAVY_REPAIR_CONTEXTS = new Set([
  "回收未监管网关后重连",
  "自动回收未监管网关",
]);

export type ConnectWithFeedbackOptions = {
  /** 启动流程已执行 prepareGatewayForConnect 时设为 true，避免重复停启网关 */
  skipPrepare?: boolean;
  /** 强制完整回收（repair + force prepare），用于监管冲突等 */
  forceRepair?: boolean;
  /** 启动/卸载时中止仍在途的连接尝试 */
  cancelled?: () => boolean;
  /** 整条连接管线超时（毫秒） */
  maxMs?: number;
  /** 重新打开时的轻量路径：少轮次重试、跳过长等待 */
  fastReopen?: boolean;
  /** 为 false 时不与 desktop-connect-scheduler 外层单飞合并（调度器内部调用须设为 false，避免自等待死锁） */
  coalesceDesktop?: boolean;
};

let connectFeedbackInFlight: Promise<boolean> | null = null;
/** 进入主界面后抑制 startupPhase 回写，避免连接管线把界面再次锁死。 */
let suppressPipelinePhaseUi = false;
let connectPipelineGeneration = 0;

function bumpConnectPipelineGeneration(): void {
  connectPipelineGeneration += 1;
}

/** 中止仍在途的连接管线（超时/失败解锁时调用，避免后台回写 startupPhase）。 */
export function invalidateConnectPipeline(): void {
  bumpConnectPipelineGeneration();
}

let getDesktopConnectInFlight: (() => Promise<boolean> | null) | null = null;

/** 由 desktop-connect-scheduler 注册，合并两套连接单飞。 */
export function wireDesktopConnectInFlight(getter: () => Promise<boolean> | null): void {
  getDesktopConnectInFlight = getter;
}

export function isConnectOrchestrationInFlight(): boolean {
  return connectFeedbackInFlight != null || getDesktopConnectInFlight?.() != null;
}

export function isConnectPipelineUiSuppressed(): boolean {
  return suppressPipelinePhaseUi;
}

/** startup 管线等外部入口写阶段文案时须走此函数，以尊重 UI 抑制标志。 */
export function setConnectPipelinePhase(message: string): void {
  setPipelinePhase(message);
}

function isStalePipeline(gen: number): boolean {
  return gen !== connectPipelineGeneration;
}

function needsHeavyGatewayRepair(
  context: string | undefined,
  opts?: ConnectWithFeedbackOptions,
): boolean {
  if (opts?.skipPrepare) return false;
  if (opts?.forceRepair) return true;
  const report = useGatewayStore.getState().exclusiveReport;
  if (report?.externalGatewayConflict) return true;
  const ctx = context?.trim();
  return Boolean(ctx && HEAVY_REPAIR_CONTEXTS.has(ctx));
}

function resolveFastReopen(
  context: string | undefined,
  opts?: ConnectWithFeedbackOptions,
): boolean {
  if (opts?.fastReopen === false) return false;
  if (opts?.fastReopen) return true;
  if (!hasGatewayEverConnected()) return false;
  return !needsHeavyGatewayRepair(context, opts);
}

async function tryConnectOnce(skipPrepare: boolean, gen: number): Promise<boolean> {
  if (isStalePipeline(gen)) return false;
  // 日常进主界面的初始态是 disconnected，必须发起连接。
  // 用户主动断开已 bump generation，由 isStalePipeline 拦截，勿在此处把空闲态当成取消。

  useGatewayStore.setState({ lastError: null, connState: "connecting" });
  await useGatewayStore
    .getState()
    .connect({ skipPrepare })
    .catch(() => undefined);

  if (isStalePipeline(gen)) {
    return useGatewayStore.getState().connState === "connected";
  }
  if (useGatewayStore.getState().connState === "connected") return true;

  if (!useGatewayStore.getState().startupPhase) {
    for (let i = 0; i < 5; i++) {
      await sleepMs(80);
      if (isStalePipeline(gen)) {
        return useGatewayStore.getState().connState === "connected";
      }
      const s = useGatewayStore.getState();
      if (s.connState === "connected") return true;
      if (s.connState === "disconnected") return false;
      if (s.lastError && s.connState === "error") break;
    }
  }
  return useGatewayStore.getState().connState === "connected";
}

function setPipelinePhase(message: string, gen?: number): void {
  if (gen != null && isStalePipeline(gen)) return;
  if (suppressPipelinePhaseUi) {
    const s = useGatewayStore.getState();
    if (s.connState === "disconnected" || s.connState === "error") {
      useGatewayStore.setState({ connState: "connecting" });
    }
    return;
  }
  useGatewayStore.setState({ startupPhase: message, lastError: null, connState: "connecting" });
}

function finalizeConnectSuccess(gen: number): boolean {
  if (!isStalePipeline(gen)) {
    useGatewayStore.setState({ startupPhase: null, lastError: null });
  } else if (useGatewayStore.getState().connState === "connected") {
    useGatewayStore.setState({ startupPhase: null, lastError: null });
  }
  return useGatewayStore.getState().connState === "connected";
}

function abortPipelineIfCancelled(cancelled: () => boolean): boolean {
  if (!cancelled()) return false;
  const s = useGatewayStore.getState();
  if (s.connState !== "connected") {
    useGatewayStore.setState({
      startupPhase: null,
      connState: s.connState === "connecting" ? "disconnected" : s.connState,
      lastError: null,
    });
  }
  return true;
}

export function applyFallbackConnectError(gen?: number): void {
  if (gen != null && isStalePipeline(gen)) return;
  const s = useGatewayStore.getState();
  if (s.lastError?.trim()) {
    useGatewayStore.setState({ startupPhase: null, connState: "error" });
    return;
  }

  const report = s.exclusiveReport;
  const supervisorUp = isSupervisorGatewayOperational(report?.supervisor ?? null);
  if (report?.externalGatewayConflict) {
    useGatewayStore.setState({
      connState: "error",
      lastError:
        `本机服务端口有未受 ${PRODUCT_NAME} 监管的进程。请点击「重连」，或到「软件设置 → 本机服务」点「回收控制权」。`,
      startupPhase: null,
    });
  } else if (!supervisorUp) {
    useGatewayStore.setState({
      connState: "error",
      lastError:
        `本机服务未在运行。请到「软件设置 → 本机服务」点「修复服务配置」或「启动本机服务」，再点「重连」；若仍失败请完全退出后重开 ${PRODUCT_NAME}。`,
      startupPhase: null,
    });
  } else {
    useGatewayStore.setState({
      connState: "error",
      lastError:
        "无法连接本机服务。请到「软件设置 → 本机服务」点「修复服务配置」或「从 .env 重新加载」，再点「连接服务」。",
      startupPhase: null,
    });
  }
}

/**
 * 进入主界面或用户点「忽略」时：清掉 startupPhase，连接仍在后台继续。
 * 同时抑制管线后续阶段文案回写，避免黄条/顶栏再次卡住。
 */
export function releaseConnectPipelineUiPhase(): void {
  suppressPipelinePhaseUi = true;
  const s = useGatewayStore.getState();
  if (s.startupPhase) {
    useGatewayStore.setState({ startupPhase: null });
  }
}

/** 日常进主界面后立刻标成连接中（冷启动等就绪时不要顶栏一直「未连接」）。 */
export function ensureBackgroundConnecting(): void {
  const s = useGatewayStore.getState();
  if (s.connState === "connected" || s.connState === "connecting") return;
  useGatewayStore.setState({ connState: "connecting" });
}

/** 登出后允许下一轮登录再写启动阶段文案（首启准备屏）。 */
export function resetConnectPipelineUiSuppression(): void {
  suppressPipelinePhaseUi = false;
}

/** 连接仍在后台进行时，解除 startupPhase 对界面的「假死」锁定。 */
export function unlockConnectPipelineForUi(hint?: string): void {
  bumpConnectPipelineGeneration();
  suppressPipelinePhaseUi = true;
  const s = useGatewayStore.getState();
  if (s.connState === "connected") {
    if (s.startupPhase) {
      useGatewayStore.setState({ startupPhase: null, lastError: null });
    }
    return;
  }
  useGatewayStore.setState({
    startupPhase: null,
    connState: s.connState === "connecting" ? "error" : s.connState,
    lastError:
      hint ??
      (s.lastError?.trim() ||
        "连接本机服务较慢。界面已解锁，可点击顶部「本机 · 重连」，或到「软件设置 → 本机服务」排查。"),
  });
}

async function runConnectPipeline(
  context: string | undefined,
  opts: ConnectWithFeedbackOptions | undefined,
  cancelled: () => boolean,
  gen: number,
): Promise<boolean> {
  if (isStalePipeline(gen)) return false;
  ensureBackgroundConnecting();
  useGatewayStore.getState().cancelReconnect();
  await awaitGatewayConnectSettled();

  const heavyRepair = needsHeavyGatewayRepair(context, opts);
  const fastReopen = resolveFastReopen(context, opts);

  setPipelinePhase(heavyRepair ? "正在回收本机服务控制权…" : "正在连接本机服务…", gen);

  const lifecycleSnap = await fetchGatewayLifecycleSnapshot();
  const skipHeavyPrep = !heavyRepair && shouldSkipHeavyGatewayPrep(lifecycleSnap);
  if (skipHeavyPrep) {
    await useGatewayStore.getState().loadGatewayPrefs().catch(() => undefined);
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    if (await tryConnectOnce(true, gen)) {
      return finalizeConnectSuccess(gen);
    }
  }

  if (isTauriRuntime() && heavyRepair) {
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    await repairGatewayConnection({ waitMs: 2_500 });
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    await prepareGatewayForConnect({ force: true });
    await useGatewayStore.getState().refreshExclusiveReport();
    const report = useGatewayStore.getState().exclusiveReport;
    if (report?.externalGatewayConflict) {
      const reclaimed = await useGatewayStore.getState().reclaimExclusive();
      if (!reclaimed) {
        useGatewayStore.setState({
          connState: "error",
          lastError:
            `本机服务端口仍有未监管进程。请完全退出 ${PRODUCT_NAME} 后重新打开，或到「软件设置 → 本机服务」点「回收控制权」。`,
          startupPhase: null,
        });
        return false;
      }
    }
    setPipelinePhase("正在连接本机服务…", gen);
  } else if (isTauriRuntime() && !opts?.skipPrepare && !skipHeavyPrep) {
    await awaitGatewayConnectSettled();
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    await prepareGatewayForConnect();
  } else if (isTauriRuntime() && !opts?.skipPrepare) {
    await useGatewayStore.getState().loadGatewayPrefs().catch(() => undefined);
  }

  if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
  if (await tryConnectOnce(true, gen)) {
    return finalizeConnectSuccess(gen);
  }

  if (isTauriRuntime() && fastReopen) {
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    if (!skipHeavyPrep) {
      setPipelinePhase("正在恢复本机服务…", gen);
      await autoRecoverSupervisorGateway().catch(() => null);
      await sleepMs(60);
      await useGatewayStore.getState().loadGatewayPrefs().catch(() => undefined);
    }
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    if (await tryConnectOnce(true, gen)) {
      return finalizeConnectSuccess(gen);
    }
    applyFallbackConnectError(gen);
    return false;
  }

  if (isTauriRuntime()) {
    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    if (!skipHeavyPrep) {
      setPipelinePhase("正在等待本机服务就绪…", gen);
      await repairGatewayConnection({ waitMs: 1_500 }).catch(() => undefined);
      if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
      await waitForGatewayReady({
        maxMs: fastReopen ? 4_000 : getLaunchConnectProfile().connectReadyWaitMs,
      });
      await useGatewayStore.getState().loadGatewayPrefs();
      await useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);
    }

    if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
    if (await tryConnectOnce(true, gen)) {
      return finalizeConnectSuccess(gen);
    }

    if (!skipHeavyPrep) {
      setPipelinePhase("正在恢复连接…", gen);
      await sleepMs(fastReopen ? 600 : 2_000);
      if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
      await autoRecoverSupervisorGateway().catch(() => null);
      await useGatewayStore.getState().loadGatewayPrefs();

      if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
      if (await tryConnectOnce(true, gen)) {
        return finalizeConnectSuccess(gen);
      }
    }
  }

  if (abortPipelineIfCancelled(cancelled) || isStalePipeline(gen)) return false;
  if (!isStalePipeline(gen) && !suppressPipelinePhaseUi) {
    useGatewayStore.setState({ startupPhase: null, lastError: null });
  }
  await tryConnectOnce(true, gen);

  if (useGatewayStore.getState().connState === "connected") {
    return finalizeConnectSuccess(gen);
  }

  applyFallbackConnectError(gen);

  if (
    isTauriRuntime() &&
    !isSupervisorGatewayOperational(useGatewayStore.getState().exclusiveReport?.supervisor ?? null)
  ) {
    await repairGatewayConnection({ waitMs: 1_500 }).catch(() => undefined);
  }

  return false;
}

/** 连接本机服务；多轮软重试后再展示错误，减少瞬态失败打扰用户。 */
export async function connectWithFeedback(
  context?: string,
  opts?: ConnectWithFeedbackOptions,
): Promise<boolean> {
  const desktopInFlight =
    opts?.coalesceDesktop !== false ? getDesktopConnectInFlight?.() : null;
  if (connectFeedbackInFlight) {
    return connectFeedbackInFlight;
  }
  if (desktopInFlight) {
    return desktopInFlight;
  }

  connectFeedbackInFlight = (async () => {
    const cancelled = () => Boolean(opts?.cancelled?.());
    const myGen = ++connectPipelineGeneration;

    try {
      const profile = getLaunchConnectProfile();
      const fastReopen = resolveFastReopen(context, opts);
      const effectiveMaxMs =
        opts?.maxMs != null && opts.maxMs > 0
          ? opts.maxMs
          : fastReopen
            ? REOPEN_CONNECT_MAX_MS
            : profile.startupConnectMaxMs;
      const pipeline = runConnectPipeline(context, opts, cancelled, myGen);
      return await withTimeout(pipeline, effectiveMaxMs, "connectWithFeedback");
    } catch (e) {
      if (!cancelled()) {
        bumpConnectPipelineGeneration();
        applyFallbackConnectError();
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("超时") || /timeout/i.test(msg)) {
          unlockConnectPipelineForUi(
            "连接本机服务超时。界面已解锁，可到「软件设置 → 本机服务」重试，或点击顶部「本机 · 重连」。",
          );
        } else {
          unlockConnectPipelineForUi();
        }
      }
      return false;
    } finally {
      if (cancelled() && useGatewayStore.getState().connState !== "connected") {
        abortPipelineIfCancelled(cancelled);
      }
      connectFeedbackInFlight = null;
      // 管线结束仍未连上且未被取消：安排后台自动续连，避免「连接不上还死等手动重试」。
      // 用宏任务延后，确保外层 requestDesktopConnect 单飞已释放，不会被 shouldDeferAutoReconnect 拦截。
      const gs = useGatewayStore.getState();
      if (!cancelled() && gs.connState !== "connected" && gs.autoReconnect) {
        window.setTimeout(() => {
          const s = useGatewayStore.getState();
          if (s.connState === "connected" || !s.autoReconnect) return;
          if (isConnectOrchestrationInFlight()) return;
          s.scheduleReconnect();
        }, 0);
      }
    }
  })();

  return await connectFeedbackInFlight;
}
