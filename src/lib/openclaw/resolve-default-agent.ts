/**
 * 解析网关 `agents.list` 的默认 agent，供 `agents.files.set` 等工作区 RPC 使用。
 * 响应形状随 OpenClaw 版本可能略有差异，此处做宽松解析。
 */
export async function resolveDefaultAgentId(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<string | undefined> {
  try {
    const raw = await request("agents.list", {});
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    if (typeof r.defaultId === "string" && r.defaultId.trim()) return r.defaultId.trim();
    const list = r.agents ?? r.list;
    if (!Array.isArray(list)) return undefined;
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      if (o.default === true || o.isDefault === true) {
        const id = o.id ?? o.agentId;
        if (typeof id === "string" && id.trim()) return id.trim();
      }
    }
    const first = list[0] as Record<string, unknown> | undefined;
    const id0 = first?.id ?? first?.agentId;
    if (typeof id0 === "string" && id0.trim()) return id0.trim();
  } catch {
    return undefined;
  }
  return undefined;
}
