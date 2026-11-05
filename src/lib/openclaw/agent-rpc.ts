export type AgentInfo = {
  id: string;
  name: string;
  model: string;
  provider: string;
  isDefault: boolean;
  skills: string[];
  workspace: string;
  sandboxMode: string;
  description?: string;
};

export type AgentListResult = {
  defaultId?: string;
  agents: AgentInfo[];
};

/** 从 agents.list 单条记录解析模型 ID（兼容 string / { primary } / modelConfig）。 */
export function parseAgentModelField(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  if (typeof o.primary === "string" && o.primary.trim()) return o.primary.trim();
  if (typeof o.model === "string" && o.model.trim()) return o.model.trim();
  return "";
}

export function formatAgentModelLabel(model: string): string {
  const m = model.trim();
  if (!m) return "模型未指定";
  const slash = m.lastIndexOf("/");
  const short = slash >= 0 ? m.slice(slash + 1) : m;
  return short.replace(/-/g, " ");
}

function resolveAgentModel(o: Record<string, unknown>): string {
  const direct = parseAgentModelField(o.model);
  if (direct) return direct;
  return parseAgentModelField(o.modelConfig);
}

export function parseAgentList(raw: unknown): AgentListResult {
  if (!raw || typeof raw !== "object") {
    return { agents: [] };
  }
  const r = raw as Record<string, unknown>;
  const defaultId = typeof r.defaultId === "string" ? r.defaultId.trim() : undefined;
  const list = r.agents ?? r.list;
  if (!Array.isArray(list)) {
    return { agents: [], defaultId };
  }
  const agents: AgentInfo[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = (typeof o.id === "string" ? o.id : typeof o.agentId === "string" ? o.agentId : "");
    if (!id) continue;
    const model = resolveAgentModel(o);
    const name = typeof o.name === "string" ? o.name : id;
    const isDefault = o.default === true || o.isDefault === true || id === defaultId;
    const skills: string[] = Array.isArray(o.skills)
      ? (o.skills as unknown[]).map(
          (s: unknown): string =>
            typeof s === "string" ? s : String((s as Record<string, unknown>)?.name ?? s),
        )
      : [];
    const workspace = typeof o.workspace === "string" ? o.workspace : "";
    const sandboxObj: Record<string, unknown> | null =
      o.sandbox != null && typeof o.sandbox === "object" ? (o.sandbox as Record<string, unknown>) : null;
    const sandboxMode =
      sandboxObj && typeof sandboxObj.mode === "string"
        ? sandboxObj.mode
        : typeof o.sandboxMode === "string"
          ? o.sandboxMode
          : "";
    const description = typeof o.description === "string" ? o.description : undefined;
    const provider = parseProvider(id, model);
    agents.push({ id, name, model, provider, isDefault, skills, workspace, sandboxMode, description });
  }
  return { defaultId, agents };
}

export function parseAgentInfo(raw: unknown): AgentInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === "string"
      ? o.id
      : typeof o.agentId === "string"
        ? o.agentId
        : "";
  if (!id) return null;

  const model = resolveAgentModel(o);
  const name = typeof o.name === "string" ? o.name : id;
  const skills: string[] = Array.isArray(o.skills)
    ? (o.skills as unknown[]).map(
        (s: unknown): string =>
          typeof s === "string" ? s : String((s as Record<string, unknown>)?.name ?? s),
      )
    : [];
  const workspace = typeof o.workspace === "string" ? o.workspace : "";
  const sandboxObj: Record<string, unknown> | null =
    o.sandbox != null && typeof o.sandbox === "object" ? (o.sandbox as Record<string, unknown>) : null;
  const sandboxMode =
    sandboxObj && typeof sandboxObj.mode === "string"
      ? sandboxObj.mode
      : typeof o.sandboxMode === "string"
        ? o.sandboxMode
        : "";
  const description = typeof o.description === "string" ? o.description : undefined;
  const provider = parseProvider(id, model);
  return { id, name, model, provider, isDefault: false, skills, workspace, sandboxMode, description };
}

export type AgentCreateParams = {
  /** 展示名（可含中文） */
  displayName: string;
  /** 可选 ASCII slug；网关从 name 推导 agentId */
  preferredId?: string;
  model?: string;
  /** OpenClaw 数据根（如 …/openclaw-data） */
  openclawDataDir: string;
};

const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_AGENT_ID_CHARS_RE = /[^a-z0-9_-]+/g;

/** 与 OpenClaw `normalizeAgentId` 对齐（纯中文名会落到 `main`，创建时被拒）。 */
export function normalizeAgentIdFromName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "main";
  const normalized = trimmed.toLowerCase();
  if (VALID_AGENT_ID_RE.test(trimmed)) return normalized;
  const slug = normalized
    .replace(INVALID_AGENT_ID_CHARS_RE, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  return slug || "main";
}

export function buildAgentWorkspacePath(openclawDataDir: string, agentId: string): string {
  const base = openclawDataDir.trim().replace(/[/\\]+$/, "");
  const id = normalizeAgentIdFromName(agentId);
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}workspace-${id}`;
}

/**
 * 构造网关 `agents.create` 的 name：保证 normalize 后得到非 main 的 ASCII slug，同时保留中文展示名。
 */
export function buildGatewayAgentCreateName(displayName: string, preferredId?: string): string {
  const display = displayName.trim();
  let slug = preferredId?.trim()
    ? normalizeAgentIdFromName(preferredId)
    : normalizeAgentIdFromName(display);
  if (slug === "main" || !slug) {
    slug = `agent-${Math.random().toString(36).slice(2, 8)}`;
  }
  if (!display) return slug;
  const fromDisplay = normalizeAgentIdFromName(display);
  if (fromDisplay === slug || fromDisplay === "main") {
    return `${slug} ${display}`;
  }
  return display;
}

export function qualifyAgentModelId(model: string, defaultFullModel?: string): string {
  const m = model.trim();
  if (!m) return defaultFullModel?.trim() ?? "";
  if (m.includes("/")) return m;
  const defaultFull = defaultFullModel?.trim();
  if (defaultFull?.includes("/")) {
    const provider = defaultFull.split("/")[0]?.trim();
    if (provider) return `${provider}/${m}`;
  }
  return m;
}

export function buildAgentCreateRpcParams(
  input: AgentCreateParams,
  defaultFullModel?: string,
): Record<string, unknown> {
  const gatewayName = buildGatewayAgentCreateName(input.displayName, input.preferredId);
  const slug = normalizeAgentIdFromName(
    input.preferredId?.trim() || gatewayName.split(/\s+/)[0] || gatewayName,
  );
  const workspace = buildAgentWorkspacePath(input.openclawDataDir, slug);
  const model = qualifyAgentModelId(input.model ?? "", defaultFullModel);
  const payload: Record<string, unknown> = {
    name: gatewayName,
    workspace,
  };
  if (model) payload.model = model;
  return payload;
}

export function humanizeAgentRpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as { message?: string; code?: string };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      const msg = parsed.message.trim();
      if (/main.*reserved/i.test(msg)) {
        return "名称无效：不能使用保留 ID「main」。请填写英文 Agent ID 或更换名称。";
      }
      return msg;
    }
  } catch {
    /* not JSON */
  }
  if (/main.*reserved/i.test(raw)) {
    return "名称无效：不能使用保留 ID「main」。请填写英文 Agent ID 或更换名称。";
  }
  if (/workspace/i.test(raw) && /required|missing/i.test(raw)) {
    return "创建失败：缺少 Agent 工作区路径。请更新到最新版本后重试。";
  }
  if (/invalid agents\.delete params/i.test(raw)) {
    return "删除失败：网关参数不兼容。请更新云图到最新版本后重试。";
  }
  if (/unexpected property ['"]id['"]/i.test(raw)) {
    return "删除失败：请求参数格式错误（请更新到最新版本）。";
  }
  return raw.trim() || "创建 Agent 失败";
}

export function parseAgentCreateResult(raw: unknown): AgentInfo | null {
  const direct = parseAgentInfo(raw);
  if (direct) return direct;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.ok === true && typeof r.agentId === "string" && r.agentId.trim()) {
    return parseAgentInfo({
      id: r.agentId.trim(),
      name: typeof r.name === "string" ? r.name : r.agentId,
      model: typeof r.model === "string" ? r.model : "",
      workspace: typeof r.workspace === "string" ? r.workspace : "",
    });
  }
  return null;
}

export async function createAgent(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
): Promise<AgentInfo | null> {
  const raw = await request("agents.create", params);
  return parseAgentCreateResult(raw);
}

export async function updateAgent(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  params: Record<string, unknown>,
): Promise<AgentInfo | null> {
  const raw = await request("agents.update", params);
  return parseAgentInfo(raw);
}

export async function deleteAgent(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  agentId: string,
): Promise<void> {
  const trimmed = agentId.trim();
  if (!trimmed) throw new Error("Agent ID 不能为空");
  await request("agents.delete", buildAgentDeleteRpcParams(trimmed));
}

export function buildAgentDeleteRpcParams(agentId: string): Record<string, unknown> {
  return { agentId: agentId.trim() };
}

/** 网关保留 `main` 与默认 Agent，禁止删除。 */
export function isAgentDeletable(agent: Pick<AgentInfo, "id" | "isDefault">): boolean {
  return !agent.isDefault && agent.id.trim().toLowerCase() !== "main";
}

function parseProvider(_agentId: string, model: string): string {
  const m = model.toLowerCase();
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("qwen")) return m.includes("ollama") ? "ollama" : "ollama / alibaba";
  if (m.includes("gpt") || m.includes("codex")) return "openai";
  if (m.includes("ollama")) return "ollama";
  return "";
}

export async function fetchAgentList(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): Promise<AgentListResult> {
  try {
    const raw = await request("agents.list", {});
    return parseAgentList(raw);
  } catch (e) {
    console.error("[agent-rpc] agents.list failed:", e);
    return { agents: [] };
  }
}
