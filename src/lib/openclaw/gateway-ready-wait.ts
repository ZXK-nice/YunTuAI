/**
 * 等待本机网关就绪：优先监听后端推送的 `gateway-exclusive-report`，
 * 辅以指数退避的轻量 status 查询。全局单飞，避免启动时 IPC 风暴堵死 Tauri worker。
 */
import { sleep, withTimeout } from "../async-utils";
import { useGatewayStore } from "../../stores/gatewayStore";
import { cliGatewaySupervisorStatus, type GatewaySupervisorStatus } from "./cli-bridge";
import { isSupervisorGatewayOperational } from "./connection-resilience";
import { listenGatewayExclusiveReport } from "./gateway-events";
import {
  fetchGatewayLifecycleSnapshot,
  lifecycleLooksConnectable,
  waitForGatewayLifecycleReady,
} from "./gateway-lifecycle";

/** 与 launch-connect-profile 对齐：冷启动网关常需 30s+。 */
const DEFAULT_MAX_MS = 25_000;
const STATUS_POLL_TIMEOUT_MS = 3_000;

let waitInFlight: Promise<boolean> | null = null;
let waitBudgetMs = 0;

function supervisorLooksReady(st: GatewaySupervisorStatus | null | undefined): boolean {
  return isSupervisorGatewayOperational(st, { requireHealthOk: true });
}

function readyFromStore(): boolean {
  const report = useGatewayStore.getState().exclusiveReport;
  if (report?.externalGatewayConflict) return false;
  return supervisorLooksReady(report?.supervisor ?? null);
}

async function waitOnce(maxMs: number): Promise<boolean> {
  if (readyFromStore()) return true;

  let settled = false;
  let unlisten: (() => void) | undefined;

  const settle = (_ok: boolean): void => {
    if (settled) return;
    settled = true;
    unlisten?.();
  };

  const onReady = (): boolean => {
    settle(true);
    return true;
  };

  const eventWait = new Promise<boolean>((resolve) => {
    void listenGatewayExclusiveReport((report) => {
      useGatewayStore.getState().applyExclusiveReport(report);
      if (supervisorLooksReady(report.supervisor)) {
        resolve(onReady());
      }
    }).then((u) => {
      unlisten = u;
      if (readyFromStore()) resolve(onReady());
    });
  });

  const pollWait = (async (): Promise<boolean> => {
    const deadline = Date.now() + maxMs;
    let delayMs = 180;
    let polls = 0;
    while (Date.now() < deadline && !settled) {
      if (readyFromStore()) return onReady();
      if (polls > 0 || Date.now() + delayMs >= deadline) {
        const st = await withTimeout(
          cliGatewaySupervisorStatus(),
          STATUS_POLL_TIMEOUT_MS,
          "gateway_supervisor_status",
        ).catch(() => null);
        if (supervisorLooksReady(st)) return onReady();
        if (st?.running && st.supervised && polls >= 1) return onReady();
      }
      polls += 1;
      await sleep(delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.35), 3_000);
    }
    if (!settled) settle(false);
    return false;
  })();

  return Promise.race([eventWait, pollWait]);
}

/** 单飞：进行中的等待若预算不短于本次请求，则复用；否则等它结束再按更长预算重等。 */
export function waitForGatewayReady(opts?: { maxMs?: number }): Promise<boolean> {
  const maxMs = opts?.maxMs ?? DEFAULT_MAX_MS;
  if (waitInFlight && waitBudgetMs >= maxMs) return waitInFlight;
  const run = (async () => {
    if (waitInFlight) await waitInFlight.catch(() => undefined);
    const snap = await fetchGatewayLifecycleSnapshot();
    if (lifecycleLooksConnectable(snap)) return true;
    const lifecycleOk = await waitForGatewayLifecycleReady({ maxMs });
    if (lifecycleOk) return true;
    return waitOnce(maxMs);
  })().finally(() => {
    if (waitInFlight === run) {
      waitInFlight = null;
      waitBudgetMs = 0;
    }
  });
  waitInFlight = run;
  waitBudgetMs = maxMs;
  return run;
}
