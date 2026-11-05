import { connectWithFeedback } from "../connect-with-feedback";
import { cliResyncRelayApiKey } from "./cli-bridge";
import { notifyGatewayRestartPending } from "./gateway-restart-notice";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";

let relayAuthRecoveryInFlight: Promise<boolean> | null = null;
let lastRelayAuthRecoveryAt = 0;
let relayAuthToastShown = false;
let deferredRelayAuthRecovery = false;
const RECOVERY_COOLDOWN_MS = 20_000;

/**
 * 上游 403 / 鉴权失败：强制同步内嵌 Key、重启网关并重连（带冷却，避免刷屏）。
 * 发送进行中时仅排队，避免 disconnect / 重启网关把本轮对话打成「已停止」。
 */
export async function recoverRelayUpstreamAuth(): Promise<boolean> {
  if (useSessionStore.getState().isSending) {
    deferredRelayAuthRecovery = true;
    return false;
  }

  const now = Date.now();
  if (relayAuthRecoveryInFlight) {
    return relayAuthRecoveryInFlight;
  }
  if (now - lastRelayAuthRecoveryAt < RECOVERY_COOLDOWN_MS) {
    return false;
  }
  lastRelayAuthRecoveryAt = now;
  if (!relayAuthToastShown) {
    relayAuthToastShown = true;
    notifyGatewayRestartPending("同步 API 密钥");
  }
  relayAuthRecoveryInFlight = (async () => {
    try {
      await cliResyncRelayApiKey();
      await useGatewayStore.getState().loadGatewayPrefs();
      const gs = useGatewayStore.getState();
      if (gs.connState === "connected" || gs.connState === "connecting") {
        gs.disconnect();
      }
      return await connectWithFeedback("修复 API 密钥", { skipPrepare: true });
    } catch {
      return false;
    } finally {
      relayAuthRecoveryInFlight = null;
    }
  })();
  return relayAuthRecoveryInFlight;
}

/** 发送结束后执行排队的鉴权恢复（若有）。 */
export function flushDeferredRelayAuthRecovery(): void {
  if (!deferredRelayAuthRecovery) return;
  if (useSessionStore.getState().isSending) return;
  deferredRelayAuthRecovery = false;
  void recoverRelayUpstreamAuth();
}
