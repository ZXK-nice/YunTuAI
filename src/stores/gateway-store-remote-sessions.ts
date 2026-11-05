import { getGatewayClient } from "../lib/openclaw/gateway-runtime";
import { extractSessionKey } from "../lib/openclaw/session-rpc";

/**
 * 网关 `sessions.create` 要求 label 全局唯一；本地多条「新会话」会冲突，故用本地 sessionId 拼唯一 label。
 */
export function gatewaySessionLabelForCreate(localTitle: string, localSessionId: string): string {
  const t = localTitle.trim() || "会话";
  const id = localSessionId.replace(/-/g, "").slice(0, 12);
  return `${t} · ${id}`;
}

export async function gatewayCreateRemoteSession(
  displayTitle: string,
  localSessionId: string,
  agentId?: string,
): Promise<string | undefined> {
  const client = getGatewayClient();
  const params: Record<string, unknown> = {
    label: gatewaySessionLabelForCreate(displayTitle, localSessionId),
  };
  if (agentId?.trim()) {
    params.agentId = agentId.trim();
  }
  const raw = await client.request<unknown>("sessions.create", params);
  return extractSessionKey(raw) ?? extractSessionKey((raw as { result?: unknown })?.result);
}

export async function gatewayListSessions(): Promise<unknown> {
  const client = getGatewayClient();
  return client.request("sessions.list", {});
}
