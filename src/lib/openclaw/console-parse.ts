/** 从 Gateway RPC 响应中 best-effort 提取数组。 */

export function unwrapRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

export function extractArray(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  const r = unwrapRecord(raw);
  if (!r) return [];
  for (const k of keys) {
    const v = r[k];
    if (Array.isArray(v)) return v;
  }
  for (const nest of ["result", "data", "payload"] as const) {
    const inner = r[nest];
    if (inner && typeof inner === "object") {
      const arr = extractArray(inner, keys);
      if (arr.length) return arr;
    }
  }
  return [];
}

export type CronJobRow = {
  id: string;
  schedule?: string;
  enabled?: boolean;
  label?: string;
  raw: Record<string, unknown>;
};

export function parseCronJobs(raw: unknown): CronJobRow[] {
  const list = extractArray(raw, ["jobs", "crons", "items", "list"]);
  const out: CronJobRow[] = [];
  for (const item of list) {
    const o = unwrapRecord(item);
    if (!o) continue;
    const id = String(o.id ?? o.jobId ?? o.name ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      schedule: typeof o.schedule === "string" ? o.schedule : typeof o.cron === "string" ? o.cron : undefined,
      enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
      label: typeof o.label === "string" ? o.label : typeof o.name === "string" ? o.name : undefined,
      raw: o,
    });
  }
  return out;
}

export type PairRequestRow = {
  id: string;
  label?: string;
  status?: string;
  raw: Record<string, unknown>;
};

export function parsePairRequests(raw: unknown, idKeys = ["id", "requestId", "pairingId"]): PairRequestRow[] {
  const list = extractArray(raw, ["requests", "pairs", "pending", "items", "list"]);
  const out: PairRequestRow[] = [];
  for (const item of list) {
    const o = unwrapRecord(item);
    if (!o) continue;
    let id = "";
    for (const k of idKeys) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) {
        id = v.trim();
        break;
      }
    }
    if (!id) continue;
    out.push({
      id,
      label: typeof o.label === "string" ? o.label : typeof o.name === "string" ? o.name : undefined,
      status: typeof o.status === "string" ? o.status : undefined,
      raw: o,
    });
  }
  return out;
}

export type GatewaySessionRow = {
  key: string;
  label?: string;
  agentId?: string;
  updatedAt?: string;
  raw: Record<string, unknown>;
};

export function parseGatewaySessions(raw: unknown): GatewaySessionRow[] {
  const list = extractArray(raw, ["sessions", "items", "list"]);
  const out: GatewaySessionRow[] = [];
  for (const item of list) {
    const o = unwrapRecord(item);
    if (!o) continue;
    const key = String(o.sessionKey ?? o.key ?? o.id ?? "").trim();
    if (!key) continue;
    out.push({
      key,
      label: typeof o.label === "string" ? o.label : typeof o.title === "string" ? o.title : undefined,
      agentId: typeof o.agentId === "string" ? o.agentId : undefined,
      updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
      raw: o,
    });
  }
  return out;
}

export type SkillStatusRow = {
  name: string;
  enabled?: boolean;
  description?: string;
  raw: Record<string, unknown>;
};

export function parseSkillStatus(raw: unknown): SkillStatusRow[] {
  const r = unwrapRecord(raw);
  if (!r) return [];
  const entries = r.entries ?? r.skills ?? r.items;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    const out: SkillStatusRow[] = [];
    for (const [name, val] of Object.entries(entries as Record<string, unknown>)) {
      const o = unwrapRecord(val) ?? {};
      out.push({
        name,
        enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
        description: typeof o.description === "string" ? o.description : undefined,
        raw: o,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const list = extractArray(raw, ["skills", "items", "list"]);
  const out: SkillStatusRow[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ name: item, raw: { name: item } });
      continue;
    }
    const o = unwrapRecord(item);
    if (!o) continue;
    const name = String(o.name ?? o.id ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
      description: typeof o.description === "string" ? o.description : undefined,
      raw: o,
    });
  }
  return out;
}

export type CompactionBranchRow = {
  id: string;
  label?: string;
  createdAt?: string;
  raw: Record<string, unknown>;
};

export function parseCompactionBranches(raw: unknown): CompactionBranchRow[] {
  const list = extractArray(raw, ["branches", "items", "compactions", "list"]);
  const out: CompactionBranchRow[] = [];
  for (const item of list) {
    const o = unwrapRecord(item);
    if (!o) continue;
    const id = String(o.id ?? o.branchId ?? o.compactionId ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      label: typeof o.label === "string" ? o.label : typeof o.name === "string" ? o.name : undefined,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : undefined,
      raw: o,
    });
  }
  return out;
}

export function summarizeUsage(raw: unknown): { lines: string[]; json: string } {
  const r = unwrapRecord(raw);
  if (!r) return { lines: ["无数据"], json: "{}" };
  const lines: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (v == null) continue;
    if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  return { lines, json: JSON.stringify(r, null, 2) };
}
