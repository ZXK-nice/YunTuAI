/** 网关 WebSocket JSON 帧（子集），协议见上游网关文档。 */

export type GatewayReq = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayRes = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

export type GatewayEvent = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
};

export type GatewayMessage = GatewayReq | GatewayRes | GatewayEvent;

export function isGatewayMessage(x: unknown): x is GatewayMessage {
  if (!x || typeof x !== "object") return false;
  const t = (x as { type?: unknown }).type;
  return t === "req" || t === "res" || t === "event";
}
