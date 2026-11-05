import { getItem, setItem, removeItem } from "./safeStorage";
import { isTauriRuntime } from "./tauri-env";

const GATEWAY_EVER_CONNECTED_KEY = "yuntuai.gatewayEverConnected";
const FIRST_RUN_GATE_SKIPPED_KEY = "yuntuai.firstRunGatewaySkipped";
const FIRST_RUN_SKIP_AT_KEY = "yuntuai.firstRunGatewaySkippedAt";

/** 跳过首跑门禁后 7 天自动失效，未连上网关则重新提示。 */
const SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 本机是否曾成功连上过网关（用于首次安装引导）。 */
export function hasGatewayEverConnected(): boolean {
  if (!isTauriRuntime()) return true;
  return getItem(GATEWAY_EVER_CONNECTED_KEY) === "1";
}

/** 卸载后重装 / 空库首装：清除前端首跑标记（WebView localStorage 不会随 MSI 卸载删除）。 */
export function resetFirstRunClientState(): void {
  if (!isTauriRuntime()) return;
  removeItem(GATEWAY_EVER_CONNECTED_KEY);
  removeItem(FIRST_RUN_GATE_SKIPPED_KEY);
  removeItem(FIRST_RUN_SKIP_AT_KEY);
}

export function markGatewayEverConnected(): void {
  if (!isTauriRuntime()) return;
  setItem(GATEWAY_EVER_CONNECTED_KEY, "1");
  removeItem(FIRST_RUN_GATE_SKIPPED_KEY);
  removeItem(FIRST_RUN_SKIP_AT_KEY);
}

/** 用户主动跳过首次网关引导（7 天内有效；到期且仍未连接则重新提示）。 */
export function skipFirstRunGatewayGate(): void {
  if (!isTauriRuntime()) return;
  setItem(FIRST_RUN_GATE_SKIPPED_KEY, "1");
  setItem(FIRST_RUN_SKIP_AT_KEY, String(Date.now()));
}

export function hasSkippedFirstRunGatewayGate(): boolean {
  if (!isTauriRuntime()) return false;
  if (getItem(FIRST_RUN_GATE_SKIPPED_KEY) !== "1") return false;
  if (hasGatewayEverConnected()) return false;

  const atRaw = getItem(FIRST_RUN_SKIP_AT_KEY);
  if (!atRaw) {
    removeItem(FIRST_RUN_GATE_SKIPPED_KEY);
    return false;
  }
  const at = Number(atRaw);
  if (!Number.isFinite(at) || at <= 0) return true;
  if (Date.now() - at > SKIP_TTL_MS) {
    removeItem(FIRST_RUN_GATE_SKIPPED_KEY);
    removeItem(FIRST_RUN_SKIP_AT_KEY);
    return false;
  }
  return true;
}

/** 首次安装 / 从未连上网关：需完成解压（若有）并等待网关就绪。 */
export function isFirstRunGatewayPending(): boolean {
  if (!isTauriRuntime()) return false;
  if (hasSkippedFirstRunGatewayGate()) return false;
  return !hasGatewayEverConnected();
}
