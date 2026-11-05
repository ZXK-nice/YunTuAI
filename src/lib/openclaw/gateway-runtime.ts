import { GatewayWsClient } from "./gateway-client";

let singleton: GatewayWsClient | null = null;

export function getGatewayClient(): GatewayWsClient {
  if (!singleton) singleton = new GatewayWsClient();
  return singleton;
}
