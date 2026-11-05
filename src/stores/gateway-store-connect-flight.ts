import type { GatewayConnState } from "./gateway-store-types";

/** 合并并发 connect 的可变飞行状态（跨模块共享，避免循环依赖）。 */
export const gatewayConnectFlight = {
  inFlight: null as Promise<void> | null,
  generation: 0,
  lastExclusiveFetchAt: 0,
  connStateBeforeConnect: "disconnected" as GatewayConnState,
  suppressNextReconnectSuccessToast: false,
};

export async function awaitGatewayConnectSettled(): Promise<void> {
  if (gatewayConnectFlight.inFlight) {
    await gatewayConnectFlight.inFlight.catch(() => undefined);
  }
}
