import { isTauriRuntime } from "../tauri-env";

/** 桌面端：必须连上网关后才进入主界面（禁止后台静默连接）。 */
export function shouldUseFullScreenConnectGate(): boolean {
  return isTauriRuntime();
}

/** 产品要求：连接成功前不提供「离线进入」。 */
export function connectGateEscapeMs(): number {
  return Number.POSITIVE_INFINITY;
}
