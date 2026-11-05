/** OpenClaw exec / plugin approval（与 Control UI 协议对齐）。 */

export type ExecApprovalDecision = "allow-once" | "allow-always" | "deny";

export type ExecApprovalRequestPayload = {
  command: string;
  cwd?: string | null;
  host?: string | null;
  security?: string | null;
  ask?: string | null;
  agentId?: string | null;
  resolvedPath?: string | null;
  sessionKey?: string | null;
  allowedDecisions?: ExecApprovalDecision[];
};

export type ExecApprovalRequest = {
  id: string;
  kind: "exec" | "plugin";
  request: ExecApprovalRequestPayload;
  pluginTitle?: string;
  pluginDescription?: string | null;
  pluginSeverity?: string | null;
  pluginId?: string | null;
  createdAtMs: number;
  expiresAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAllowedDecisions(value: unknown): ExecApprovalDecision[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decisions = value.filter(
    (d): d is ExecApprovalDecision => d === "allow-once" || d === "allow-always" || d === "deny",
  );
  return decisions.length > 0 ? decisions : undefined;
}

export function parseExecApprovalRequested(payload: unknown): ExecApprovalRequest | null {
  if (!isRecord(payload)) return null;
  const id = optString(payload.id) ?? "";
  const request = payload.request;
  if (!id || !isRecord(request)) return null;
  const command = typeof request.command === "string" ? request.command : "";
  if (!command.trim()) return null;
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) return null;
  return {
    id,
    kind: "exec",
    request: {
      command,
      cwd: typeof request.cwd === "string" ? request.cwd : null,
      host: typeof request.host === "string" ? request.host : null,
      security: typeof request.security === "string" ? request.security : null,
      ask: typeof request.ask === "string" ? request.ask : null,
      agentId: typeof request.agentId === "string" ? request.agentId : null,
      resolvedPath: typeof request.resolvedPath === "string" ? request.resolvedPath : null,
      sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
      allowedDecisions: parseAllowedDecisions(request.allowedDecisions),
    },
    createdAtMs,
    expiresAtMs,
  };
}

export function parsePluginApprovalRequested(payload: unknown): ExecApprovalRequest | null {
  if (!isRecord(payload)) return null;
  const id = optString(payload.id) ?? "";
  if (!id) return null;
  const createdAtMs = typeof payload.createdAtMs === "number" ? payload.createdAtMs : 0;
  const expiresAtMs = typeof payload.expiresAtMs === "number" ? payload.expiresAtMs : 0;
  if (!createdAtMs || !expiresAtMs) return null;
  const request = isRecord(payload.request) ? payload.request : {};
  const title = optString(request.title) ?? "";
  if (!title) return null;
  return {
    id,
    kind: "plugin",
    request: {
      command: title,
      agentId: typeof request.agentId === "string" ? request.agentId : null,
      sessionKey: typeof request.sessionKey === "string" ? request.sessionKey : null,
      allowedDecisions: parseAllowedDecisions(request.allowedDecisions),
    },
    pluginTitle: title,
    pluginDescription: typeof request.description === "string" ? request.description : null,
    pluginSeverity: typeof request.severity === "string" ? request.severity : null,
    pluginId: typeof request.pluginId === "string" ? request.pluginId : null,
    createdAtMs,
    expiresAtMs,
  };
}

/** 「稍后」默认挂起时长。 */
export const APPROVAL_SNOOZE_MS = 3 * 60_000;
/** 必须早于网关过期至少这么久，否则网关会先把审批作废。 */
export const APPROVAL_SNOOZE_EXPIRY_BUFFER_MS = 10_000;

/** 计算「稍后」再次弹出的时间；距过期太近则无法稍后（返回 null）。 */
export function computeApprovalSnoozeUntil(nowMs: number, expiresAtMs: number): number | null {
  const latest = expiresAtMs - APPROVAL_SNOOZE_EXPIRY_BUFFER_MS;
  if (latest <= nowMs) return null;
  return Math.min(nowMs + APPROVAL_SNOOZE_MS, latest);
}

export function pruneExecApprovalQueue(queue: ExecApprovalRequest[]): ExecApprovalRequest[] {
  const now = Date.now();
  return queue.filter((e) => e.expiresAtMs > now);
}

export function parseApprovalList(
  payload: unknown,
  parseEntry: (entry: unknown) => ExecApprovalRequest | null,
): ExecApprovalRequest[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((entry) => {
    const parsed = parseEntry(entry);
    return parsed ? [parsed] : [];
  });
}

export function defaultDecisions(entry: ExecApprovalRequest): ExecApprovalDecision[] {
  return entry.request.allowedDecisions?.length
    ? [...entry.request.allowedDecisions]
    : ["allow-once", "allow-always", "deny"];
}

export async function resolveExecApproval(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  id: string,
  decision: ExecApprovalDecision,
  kind: ExecApprovalRequest["kind"],
): Promise<void> {
  const method = kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve";
  await request(method, { id, decision });
}

export async function fetchPendingApprovals(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<ExecApprovalRequest[]> {
  const [execResult, pluginResult] = await Promise.allSettled([
    request("exec.approval.list", {}),
    request("plugin.approval.list", {}),
  ]);
  const exec =
    execResult.status === "fulfilled"
      ? parseApprovalList(execResult.value, parseExecApprovalRequested)
      : [];
  const plugin =
    pluginResult.status === "fulfilled"
      ? parseApprovalList(pluginResult.value, parsePluginApprovalRequested)
      : [];
  return pruneExecApprovalQueue([...exec, ...plugin]).sort((a, b) => b.createdAtMs - a.createdAtMs);
}
