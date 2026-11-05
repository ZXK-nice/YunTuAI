import { getItem, removeItem, setItem } from "../lib/safeStorage";
import { reconnectBackoffMs } from "../lib/openclaw/connection-resilience";

export const LS_URL = "yuntuai.gateway.wsUrl";
export const LS_TOKEN = "yuntuai.gateway.tokenOverride";
export const LS_AUTO_REMEDIATE = "yuntuai.gateway.autoRemediate";
export const LS_STALL_WATCHDOG = "yuntuai.gateway.stallWatchdog";
export const DEFAULT_PORT = 18789;
export const CONNECTION_MONITOR_INTERVAL_MS = 30_000;
export const CONNECTION_MONITOR_START_DELAY_MS = 12_000;
export const HEALTH_RPC_MS = 6_000;
export const CONNECT_POST_HANDSHAKE_DEFER_MS = 200;
export const CONNECT_POST_HANDSHAKE_PROBE_MS = 4_000;
export const CONNECT_POST_HANDSHAKE_RETRIES = 2;
export const CONNECT_DEFERRED_SYNC_MS = 1_800;
export const RECONNECT_SOON_MS = 1_500;
export const EXCLUSIVE_REPORT_MIN_INTERVAL_MS = 5_000;
/** 健康检查需连续失败 3 次才触发自动恢复 */
export const STALL_FAILS_BEFORE_RECOVERY = 3;
export const STALL_WS_ACTIVITY_GRACE_MS = 90_000;
export const RECONNECT_SOON_FAST_ATTEMPTS = 3;
export const STEP_INGEST_FLUSH_MS = 48;
export const GATEWAY_CONNECT_MAX_MS = 30_000;
export const MAX_RECONNECT_ATTEMPTS = 10;

export function purgeLegacyGatewayTokenOverride(): void {
  removeItem(LS_TOKEN);
}

export function persistLocalPrefs(wsUrl: string, _token?: string) {
  setItem(LS_URL, wsUrl);
  purgeLegacyGatewayTokenOverride();
}

export function loadLocalPrefs(): { wsUrl?: string } {
  return {
    wsUrl: getItem(LS_URL) ?? undefined,
  };
}

export function readAutoRemediateDefaultTrue(): boolean {
  return getItem(LS_AUTO_REMEDIATE) !== "0";
}

export function readStallWatchdogDefaultTrue(): boolean {
  return getItem(LS_STALL_WATCHDOG) !== "0";
}

export function backoffMs(attempt: number, rateLimited = false): number {
  return reconnectBackoffMs(attempt, { rateLimited });
}

/** 避免网关启动期 RPC 挂起导致界面长期停在「连接中」 */
export async function rpcWithTimeout<T>(
  label: string,
  fn: () => Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} 超时（${ms}ms）`)), ms);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
