import { invokeWithAuthRetry } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import { isInStartupGrace } from "./gateway-recovery";
import { isGatewayRecoveryInFlight } from "./gateway-recovery-lock";
import { revealPathInOs } from "./os-open";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";

const DISCONNECT_DIAGNOSE_MS = 120_000;
const DISCONNECT_DIAGNOSE_COOLDOWN_MS = 30 * 60_000;

export type DiagnoseReportResult = {
  ok: boolean;
  reportPath?: string | null;
  exitCode?: number | null;
  stdoutTail?: string;
  error?: string | null;
};

let disconnectedSinceMs: number | null = null;
let lastDiagnosticAtMs = 0;
let diagnosticInFlight = false;
let unsubscribe: (() => void) | null = null;

function isDisconnectedState(connState: string, startupPhase: string | null): boolean {
  if (startupPhase) return false;
  // 连接中不算断连，避免慢速握手误触发桌面体检
  return connState === "disconnected" || connState === "error";
}

async function runDisconnectDiagnostic(): Promise<DiagnoseReportResult | null> {
  if (!isTauriRuntime()) return null;
  if (diagnosticInFlight) return null;
  diagnosticInFlight = true;
  try {
    const res = await invokeWithAuthRetry<DiagnoseReportResult>("yuntuai_run_diagnose_report", {});
    if (!res) return null;
    if (res.ok && res.reportPath) {
      lastDiagnosticAtMs = Date.now();
      useUiStore
        .getState()
        .showToast("连接异常超过 2 分钟，已自动生成诊断报告（安装目录 diagnostics 文件夹）", "warning");
      try {
        await revealPathInOs(res.reportPath);
      } catch {
        /* ignore */
      }
    } else {
      useUiStore
        .getState()
        .showToast(res.error ?? "自动诊断失败，请到软件设置复制连接诊断", "error");
    }
    return res;
  } finally {
    diagnosticInFlight = false;
  }
}

/** 在 bootstrap 中调用一次，订阅断连时长并在超 2 分钟时自动体检。 */
export function initAutoDisconnectDiagnostic(): () => void {
  if (unsubscribe) return unsubscribe;

  unsubscribe = useGatewayStore.subscribe((state, prev) => {
    if (state.connState === "connected") {
      disconnectedSinceMs = null;
      return;
    }
    if (prev.connState === "connected" || disconnectedSinceMs == null) {
      if (isDisconnectedState(state.connState, state.startupPhase)) {
        disconnectedSinceMs = Date.now();
      }
    }
  });

  return unsubscribe;
}

/** 由周期 watchdog 调用。 */
export async function maybeRunAutoDisconnectDiagnostic(): Promise<void> {
  if (!isTauriRuntime()) return;
  const gw = useGatewayStore.getState();
  if (gw.connState === "connected") return;
  if (isInStartupGrace()) return;
  if (isGatewayRecoveryInFlight()) return;
  if (disconnectedSinceMs == null) {
    if (isDisconnectedState(gw.connState, gw.startupPhase)) {
      disconnectedSinceMs = Date.now();
    } else {
      return;
    }
  }
  const elapsed = Date.now() - disconnectedSinceMs;
  if (elapsed < DISCONNECT_DIAGNOSE_MS) return;
  if (Date.now() - lastDiagnosticAtMs < DISCONNECT_DIAGNOSE_COOLDOWN_MS) return;
  await runDisconnectDiagnostic();
}
