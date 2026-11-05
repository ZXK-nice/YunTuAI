/**
 * 本机服务生命周期 — 订阅 Rust 推送的单一真相源，减少前端重复 ensure/health 判断。
 */
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import type { GatewaySupervisorStatus } from "./cli-bridge";
import { sleep, withTimeout } from "../async-utils";
import { GATEWAY_RECOVERY_TIMEOUT_MS } from "./gateway-recovery-policy";

export type GatewayLifecyclePhase =
  | "preparing"
  | "starting"
  | "healthy"
  | "degraded"
  | "failed";

export type GatewayLifecycleSnapshot = {
  phase: GatewayLifecyclePhase;
  detail: string;
  at: string;
  establishComplete: boolean;
  /** establish 工作线程仍在跑（超时放行后也可能为 true） */
  establishWorkActive?: boolean;
  processAlive: boolean;
  portReachable: boolean;
  processBusyLikely: boolean;
  wsConnectSuggested: boolean;
  externalConflict: boolean;
  bundledReady: boolean;
  supervisor: GatewaySupervisorStatus;
};

export type GatewayServiceDiagnosticSnapshot = {
  lifecycle: GatewayLifecycleSnapshot;
  dataDir: string | null;
  listenPort: number;
  provisionNeeded: boolean;
  runtimeAvailable: boolean;
};

export type GatewayRecoveryResult = {
  ok: boolean;
  method: string;
  message: string;
  lifecycle: GatewayLifecycleSnapshot;
};

type LifecycleStore = {
  snapshot: GatewayLifecycleSnapshot | null;
  setSnapshot: (s: GatewayLifecycleSnapshot) => void;
};

export const useGatewayLifecycleStore = create<LifecycleStore>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

let listenStarted = false;

export function isLifecyclePhaseReady(
  phase: GatewayLifecyclePhase | null | undefined,
): boolean {
  return phase === "healthy" || phase === "degraded";
}

export function lifecycleLooksConnectable(
  snap: GatewayLifecycleSnapshot | null | undefined,
): boolean {
  if (!snap || snap.externalConflict) return false;
  if (snap.wsConnectSuggested && snap.portReachable) return true;
  // 端口已监听且进程在跑：允许 WS 握手（health 可能仍滞后）
  if (snap.portReachable && snap.processAlive && snap.establishComplete) return true;
  const sup = snap.supervisor;
  if (snap.portReachable && sup.running && sup.supervised) return true;
  return false;
}

/** 监管进程在跑、端口可达，仅 health 滞后或 degraded：跳过 stop_all/restart 等重型准备。 */
export function shouldSkipHeavyGatewayPrep(
  snap: GatewayLifecycleSnapshot | null | undefined,
): boolean {
  if (!snap) return false;
  // establish 未完成或后台仍在跑：禁止 suppress/ensure/stop_all（与 Rust establish 竞态会卡死窗口）
  if (!snap.establishComplete || snap.establishWorkActive) return true;
  if (snap.externalConflict) return false;
  if (lifecycleLooksConnectable(snap)) return true;
  if (snap.processBusyLikely) return true;
  const sup = snap.supervisor;
  return Boolean(snap.portReachable && sup.running && sup.supervised);
}

/** 等待 OpenClaw establish_absolute_control 完成（前端门闸用，避免与重型网关治理竞态）。 */
export async function waitForEstablishComplete(opts?: { maxMs?: number }): Promise<boolean> {
  if (!isTauriRuntime()) return true;
  const maxMs = opts?.maxMs ?? 90_000;
  const current = useGatewayLifecycleStore.getState().snapshot;
  if (current?.establishComplete) return true;
  if (
    current &&
    lifecycleLooksConnectable(current) &&
    current.supervisor?.supervised
  ) {
    return true;
  }

  const deadline = Date.now() + maxMs;
  let delayMs = 250;
  while (Date.now() < deadline) {
    const snap = await fetchGatewayLifecycleSnapshot();
    if (snap?.establishComplete) return true;
    if (snap && lifecycleLooksConnectable(snap) && snap.supervisor?.supervised) {
      return true;
    }
    await sleep(delayMs);
    delayMs = Math.min(Math.round(delayMs * 1.35), 2_500);
  }
  return Boolean(useGatewayLifecycleStore.getState().snapshot?.establishComplete);
}

/** 被动等待超时后主动拉起本机服务，再短等就绪。 */
export async function ensureGatewayServiceReady(opts?: {
  maxWaitMs?: number;
}): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const maxWaitMs = opts?.maxWaitMs ?? 12_000;
  let snap = await fetchGatewayLifecycleSnapshot();
  if (lifecycleLooksConnectable(snap)) return true;

  // establish 未完成时禁止 ensure_running（会 PowerShell 扫全机 node，易卡死窗口）
  if (!snap?.establishComplete) {
    const waited = await waitForGatewayLifecycleReady({ maxMs: maxWaitMs });
    if (waited) return true;
    snap = await fetchGatewayLifecycleSnapshot();
    if (!snap?.establishComplete) {
      return lifecycleLooksConnectable(snap);
    }
  }

  snap = await fetchGatewayLifecycleSnapshot();
  if (shouldSkipHeavyGatewayPrep(snap)) {
    return lifecycleLooksConnectable(snap) || Boolean(snap?.supervisor?.running && snap?.portReachable);
  }

  const { autoRecoverSupervisorGateway } = await import("./auto-supervisor-recovery");
  if (await autoRecoverSupervisorGateway()) return true;

  const waitedReady = await waitForGatewayLifecycleReady({ maxMs: maxWaitMs });
  if (waitedReady) return true;

  snap = await fetchGatewayLifecycleSnapshot();
  return lifecycleLooksConnectable(snap);
}

export async function fetchGatewayLifecycleSnapshot(): Promise<GatewayLifecycleSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const snap = await withTimeout(
      invokeAuthed<GatewayLifecycleSnapshot>("gateway_lifecycle_snapshot", {}),
      4_000,
      "gateway_lifecycle_snapshot",
    );
    useGatewayLifecycleStore.getState().setSnapshot(snap);
    return snap;
  } catch {
    return null;
  }
}

export async function fetchGatewayServiceDiagnostic(): Promise<GatewayServiceDiagnosticSnapshot | null> {
  if (!isTauriRuntime()) return null;
  try {
    const snap = await withTimeout(
      invokeAuthed<GatewayServiceDiagnosticSnapshot>(
        "gateway_service_diagnostic_snapshot",
        {},
      ),
      6_000,
      "gateway_service_diagnostic_snapshot",
    );
    useGatewayLifecycleStore.getState().setSnapshot(snap.lifecycle);
    return snap;
  } catch {
    return null;
  }
}

export async function requestGatewaySupervisorRecovery(): Promise<GatewayRecoveryResult | null> {
  if (!isTauriRuntime()) return null;
  try {
    const result = await withTimeout(
      invokeAuthed<GatewayRecoveryResult>("gateway_supervisor_request_recovery", {}),
      GATEWAY_RECOVERY_TIMEOUT_MS,
      "gateway_supervisor_request_recovery",
    );
    useGatewayLifecycleStore.getState().setSnapshot(result.lifecycle);
    return result;
  } catch {
    return null;
  }
}

export function listenGatewayLifecycleState(
  handler: (snap: GatewayLifecycleSnapshot) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<GatewayLifecycleSnapshot>("gateway-lifecycle-state", (event) => {
    useGatewayLifecycleStore.getState().setSnapshot(event.payload);
    handler(event.payload);
  });
}

/** 应用启动时注册生命周期监听（幂等）。 */
export function ensureGatewayLifecycleListener(): void {
  if (!isTauriRuntime() || listenStarted) return;
  listenStarted = true;
  void listenGatewayLifecycleState(() => undefined);
}

let waitInFlight: Promise<boolean> | null = null;

/**
 * 等待生命周期进入可连接态（healthy/degraded + wsConnectSuggested）。
 * 优先监听 `gateway-lifecycle-state`，辅以轻量 RPC 轮询。
 */
export async function waitForGatewayLifecycleReady(opts?: {
  maxMs?: number;
}): Promise<boolean> {
  if (waitInFlight) return waitInFlight;
  const maxMs = opts?.maxMs ?? 14_000;
  waitInFlight = waitOnce(maxMs).finally(() => {
    waitInFlight = null;
  });
  return waitInFlight;
}

async function waitOnce(maxMs: number): Promise<boolean> {
  const current = useGatewayLifecycleStore.getState().snapshot;
  if (lifecycleLooksConnectable(current)) return true;

  let settled = false;
  let unlisten: (() => void) | undefined;

  const settle = (ok: boolean): boolean => {
    if (settled) return ok;
    settled = true;
    unlisten?.();
    return ok;
  };

  const eventWait = new Promise<boolean>((resolve) => {
    void listenGatewayLifecycleState((snap) => {
      if (lifecycleLooksConnectable(snap)) resolve(settle(true));
    }).then((u) => {
      unlisten = u;
      const snap = useGatewayLifecycleStore.getState().snapshot;
      if (lifecycleLooksConnectable(snap)) resolve(settle(true));
    });
  });

  const pollWait = (async (): Promise<boolean> => {
    const deadline = Date.now() + maxMs;
    let delayMs = 200;
    while (Date.now() < deadline && !settled) {
      const snap = await fetchGatewayLifecycleSnapshot();
      if (lifecycleLooksConnectable(snap)) return settle(true);
      await sleep(delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.35), 2_500);
    }
    if (!settled) settle(false);
    return false;
  })();

  return Promise.race([eventWait, pollWait]);
}

/** 供诊断导出：合并生命周期与监管报告摘要 */
export function formatLifecycleDiagnosticLine(
  snap: GatewayLifecycleSnapshot | null,
): string {
  if (!snap) return "lifecycle: (unknown)";
  return [
    `phase=${snap.phase}`,
    `processAlive=${snap.processAlive}`,
    `port=${snap.portReachable}`,
    `busyLikely=${snap.processBusyLikely}`,
    `conflict=${snap.externalConflict}`,
    `detail=${snap.detail}`,
  ].join(" ");
}
