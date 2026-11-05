/**
 * 启动宽限期内：若首次连接失败，按阶梯延迟静默重试（不弹吓人 toast）。
 */
import { isInStartupGrace } from "./gateway-recovery";
import { isConnectOrchestrationInFlight } from "../connect-with-feedback";
import { getLaunchConnectProfile } from "./launch-connect-profile";
import { requestDesktopConnect } from "./desktop-connect-scheduler";
import { useGatewayStore } from "../../stores/gatewayStore";

const BOOT_RETRY_DELAYS_MS = [15_000, 30_000, 50_000] as const;

let retryGeneration = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function clearBootConnectRetryTimer(): void {
  if (retryTimer != null) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

export function cancelBootConnectRetries(): void {
  retryGeneration += 1;
  clearBootConnectRetryTimer();
}

export function scheduleBootConnectRetries(cancelled: () => boolean): void {
  cancelBootConnectRetries();
  const generation = retryGeneration;
  let step = 0;

  const scheduleNext = (): void => {
    if (generation !== retryGeneration) return;
    if (cancelled()) return;
    if (step >= BOOT_RETRY_DELAYS_MS.length) return;

    const delay = BOOT_RETRY_DELAYS_MS[step]!;
    step += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      if (generation !== retryGeneration || cancelled()) return;
      if (!isInStartupGrace()) return;

      const gw = useGatewayStore.getState();
      if (gw.connState === "connected") return;
      if (gw.connState === "connecting" && isConnectOrchestrationInFlight()) return;

      const profile = getLaunchConnectProfile();
      void requestDesktopConnect({
        context: "启动宽限内自动重连",
        direct: true,
        fastReopen: false,
        maxMs: profile.startupConnectMaxMs,
        cancelled,
      }).finally(() => {
        if (generation !== retryGeneration || cancelled()) return;
        if (useGatewayStore.getState().connState === "connected") return;
        if (isInStartupGrace()) scheduleNext();
      });
    }, delay);
  };

  scheduleNext();
}
