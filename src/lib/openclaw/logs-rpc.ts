import { getGatewayClient } from "./gateway-runtime";

/** Gateway `logs.tail` RPC — params are best-effort; adjust per gateway version. */
export async function fetchGatewayLogsTail(params: Record<string, unknown> = {}): Promise<unknown> {
  const client = getGatewayClient();
  if (!client.isHelloOk) {
    throw new Error("请先连接 Gateway");
  }
  return client.request(
    "logs.tail",
    {
      limit: 200,
      maxBytes: 131072,
      ...params,
    },
    { timeoutMs: 45_000 },
  );
}
