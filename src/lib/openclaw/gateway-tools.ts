/**
 * 从 OpenClaw 网关 RPC 发现原生 tool 和 skill 列表。
 *
 * 调用 `tools.catalog` / `tools.effective` 与 `skills.status` / `skills.search` / `skills.bins`，
 * 不依赖本地模块注册表。
 */
import { getGatewayClient } from "./gateway-runtime";

/** OpenClaw 原生工具描述 */
export type GatewayToolInfo = {
  name: string;
  description?: string;
  /** 工具来源（如 "built-in" / "mcp" / "skill"） */
  origin?: string;
};

/** OpenClaw 技能描述 */
export type GatewaySkillInfo = {
  name: string;
  description?: string;
  version?: string;
  /** 是否已安装 */
  installed?: boolean;
  /** 技能 bin/类别 */
  bin?: string;
  source?: string;
  filePath?: string;
  eligible?: boolean;
  disabled?: boolean;
  blockedByAgentFilter?: boolean;
};

/** 用户安装/同步到工作区的技能（非 OpenClaw 内置包）。 */
export function isUserInstalledGatewaySkill(skill: GatewaySkillInfo): boolean {
  if (skill.source && skill.source !== "openclaw-bundled") return true;
  const path = (skill.filePath ?? "").replace(/\\/g, "/").toLowerCase();
  return path.includes("/workspace/") || path.includes("/.agents/skills/");
}

/** OpenClaw 自带 / 全局技能（非用户工作区安装）。 */
export function isOpenClawNativeSkill(skill: GatewaySkillInfo): boolean {
  return !isUserInstalledGatewaySkill(skill);
}

export type PartitionedGatewaySkills = {
  native: GatewaySkillInfo[];
  userInstalled: GatewaySkillInfo[];
};

/** 将 skills.status 结果分为 OpenClaw 原生 vs 用户工作区技能。 */
export function partitionGatewaySkills(skills: GatewaySkillInfo[]): PartitionedGatewaySkills {
  const native: GatewaySkillInfo[] = [];
  const userInstalled: GatewaySkillInfo[] = [];
  for (const s of skills) {
    if (isUserInstalledGatewaySkill(s)) userInstalled.push(s);
    else native.push(s);
  }
  const byName = (a: GatewaySkillInfo, b: GatewaySkillInfo) => a.name.localeCompare(b.name);
  native.sort(byName);
  userInstalled.sort(byName);
  return { native, userInstalled };
}

/** 合并网关 skills.status 与 agents.list 技能名（不用 agent 描述冒充技能说明）。 */
export function mergeGatewaySkillsWithAgentNames(
  gatewaySkills: GatewaySkillInfo[],
  agentSkillNames: string[],
): GatewaySkillInfo[] {
  const map = new Map<string, GatewaySkillInfo>();
  for (const s of gatewaySkills) {
    if (s.name) map.set(s.name, s);
  }
  for (const name of agentSkillNames) {
    const trimmed = name.trim();
    if (!trimmed || map.has(trimmed)) continue;
    map.set(trimmed, { name: trimmed, installed: true });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 按 MCP 服务名分组 origin=mcp 的工具（工具名通常为 server.tool）。 */
export function groupMcpToolsByServer(allTools: GatewayToolInfo[]): Map<string, GatewayToolInfo[]> {
  const map = new Map<string, GatewayToolInfo[]>();
  for (const t of allTools) {
    if (t.origin !== "mcp" && t.origin !== "mcp-server") continue;
    const serverName = t.name.includes(".") ? (t.name.split(".")[0] ?? t.name) : t.name;
    const list = map.get(serverName) ?? [];
    list.push(t);
    map.set(serverName, list);
  }
  return map;
}

export function enrichMcpsWithTools(
  mcps: GatewayMCPInfo[],
  allTools: GatewayToolInfo[],
): Array<GatewayMCPInfo & { tools: GatewayToolInfo[] }> {
  const grouped = groupMcpToolsByServer(allTools);
  return mcps.map((mcp) => ({
    ...mcp,
    tools: grouped.get(mcp.name) ?? [],
    toolCount: grouped.get(mcp.name)?.length ?? mcp.toolCount ?? 0,
  }));
}

/** 从网关 config 或 tools.catalog 发现的 MCP 服务器 */
export type GatewayMCPInfo = {
  name: string;
  description?: string;
  /** MCP 服务器的命令（如 "npx", "python"） */
  command?: string;
  /** 启用状态 */
  enabled?: boolean;
  /** 工具数量（从 tools.catalog origin=mcp 推算） */
  toolCount?: number;
};

/* ── tools.catalog / tools.effective ───────────── */

async function fetchToolCatalog(): Promise<GatewayToolInfo[]> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];
  try {
    const raw = await client.request<unknown>("tools.catalog", {}, { timeoutMs: 5000 });
    return parseToolList(raw);
  } catch {
    // tools.catalog 可能不支持
  }
  return [];
}

async function fetchToolsEffective(): Promise<GatewayToolInfo[]> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];
  try {
    const raw = await client.request<unknown>("tools.effective", {}, { timeoutMs: 5000 });
    return parseToolList(raw);
  } catch {
    // tools.effective 可能不支持
  }
  return [];
}

function parseToolList(raw: unknown): GatewayToolInfo[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;

  // 尝试直接数组
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return { name: item };
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return {
            name: String(o.name ?? o.id ?? o.tool ?? ""),
            description: typeof o.description === "string" ? o.description : undefined,
            origin: typeof o.origin === "string" ? o.origin : undefined,
          };
        }
        return null;
      })
      .filter((t): t is GatewayToolInfo => !!t && !!t.name);
  }

  // 尝试 .tools / .items 字段
  const list = r.tools ?? r.items ?? r.catalog;
  if (Array.isArray(list)) {
    return parseToolList(list);
  }

  // flat: { tool1: {..}, tool2: {..} }
  const tools: GatewayToolInfo[] = [];
  for (const [key, val] of Object.entries(r)) {
    if (val && typeof val === "object") {
      const o = val as Record<string, unknown>;
      tools.push({
        name: String(o.name ?? key),
        description: typeof o.description === "string" ? o.description : undefined,
        origin: typeof o.origin === "string" ? o.origin : undefined,
      });
    }
  }
  return tools;
}

/* ── skills.status ────────────────────────────── */

async function fetchSkillStatus(): Promise<GatewaySkillInfo[]> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];
  try {
    const raw = await client.request<unknown>("skills.status", {}, { timeoutMs: 5000 });
    return parseSkillList(raw);
  } catch {
    // skills.status 可能不支持
  }
  return [];
}

/** 从网关 skills.status 拉取技能列表（Agent 指挥中心 / 工具面板共用）。 */
export async function fetchGatewaySkillStatus(): Promise<GatewaySkillInfo[]> {
  return fetchSkillStatus();
}

function parseSkillList(raw: unknown): GatewaySkillInfo[] {
  if (!raw || typeof raw !== "object") return [];

  const r = raw as Record<string, unknown>;
  const nestedSkills = r.skills;
  if (Array.isArray(nestedSkills)) {
    return parseSkillList(nestedSkills);
  }

  const entries = r.entries ?? r.skills ?? r.items;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    const result: GatewaySkillInfo[] = [];
    for (const [name, val] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof val === "string") {
        result.push({ name: val || name });
        continue;
      }
      if (!val || typeof val !== "object") {
        result.push({ name });
        continue;
      }
      result.push(parseSkillRecord(name, val as Record<string, unknown>));
    }
    return result.filter((s) => !!s.name);
  }

  const list: unknown[] = Array.isArray(raw)
    ? raw
    : ((r.skills ?? r.items ?? r.list ?? r.results) as unknown[]);

  if (!Array.isArray(list)) return [];

  const result: GatewaySkillInfo[] = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === "string") {
      result.push({ name: item });
    } else if (typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? o.id ?? o.skill ?? o.skillKey ?? "").trim();
      if (!name) continue;
      result.push(parseSkillRecord(name, o));
    }
  }
  return result.filter((s) => !!s.name);
}

function parseSkillRecord(name: string, o: Record<string, unknown>): GatewaySkillInfo {
  return {
    name,
    description: typeof o.description === "string" ? o.description : undefined,
    version: typeof o.version === "string" ? o.version : undefined,
    installed: o.installed === true,
    bin: typeof o.bin === "string" ? o.bin : undefined,
    source: typeof o.source === "string" ? o.source : undefined,
    filePath: typeof o.filePath === "string" ? o.filePath : undefined,
    eligible: typeof o.eligible === "boolean" ? o.eligible : undefined,
    disabled: o.disabled === true,
    blockedByAgentFilter: o.blockedByAgentFilter === true,
  };
}

/* ── 统一入口 ──────────────────────────────────── */

export type GatewayDiscoveryResult = {
  /** 从 tools.catalog 或 tools.effective 获取的原生工具 */
  tools: GatewayToolInfo[];
  /** 从 skills.status / skills.search 获取的技能 */
  skills: GatewaySkillInfo[];
  /** 从 config.get + tools.catalog 获取的 MCP 服务器 */
  mcps: GatewayMCPInfo[];
};

/** 网关运行时配置摘要（从 config.get RPC 解析） */
export type GatewayRuntimeConfig = {
  /** gateway.mode / port / bind / auth */
  gateway: {
    mode: string;
    port: number;
    bind: string;
    authMode: string;
  };
  /** agents.defaults.model.primary */
  defaultModel: string;
  /** models.providers 下的 provider ID 列表 */
  providerNames: string[];
  /** models.providers 下每个 provider 的模型 ID 列表 */
  providerModels: Record<string, string[]>;
  /** agents.defaults.workspace */
  workspace: string;
  /** agents.defaults.sandbox.mode */
  sandboxMode: string;
  /** 原始响应的顶层键列表（用于诊断） */
  topLevelKeys: string[];
};

/**
 * 从 OpenClaw 网关注册工具中统计 origin="mcp" 的工具数（按 serverName 分组）。
 * serverName 优先从工具名的 `.` 前截取，否则用完整工具名。
 */
function countMcpToolsByServer(
  allTools: GatewayToolInfo[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of allTools) {
    if (t.origin !== "mcp" && t.origin !== "mcp-server") continue;
    const toolName = t.name ?? "";
    const serverName = toolName.includes(".")
      ? toolName.split(".")[0] ?? toolName
      : toolName;
    counts.set(serverName, (counts.get(serverName) ?? 0) + 1);
  }
  return counts;
}

/**
 * 从磁盘 openclaw.json（通过 Tauri IPC）读取 MCP 服务器定义。
 * 与 RPC config.get 互补——即使 RPC 不支持 config.get，仍能从文件获取。
 */
async function fetchMcpFromConfigFile(): Promise<GatewayMCPInfo[]> {
  try {
    const { readMcpServersFromConfig } = await import("./mcp-bridge");
    const entries = await readMcpServersFromConfig();
    return entries.map((e) => ({
      name: e.name,
      description: e.description,
      command: e.command,
      enabled: e.enabled,
      toolCount: e.toolCount,
    }));
  } catch {
    return [];
  }
}

/**
 * 从 RPC config.get 获取 MCP 服务器定义。
 */
async function fetchMcpFromRpc(
  allTools: GatewayToolInfo[],
): Promise<GatewayMCPInfo[]> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];

  try {
    const raw = await client.request<unknown>("config.get", {}, { timeoutMs: 5000 });
    if (!raw || typeof raw !== "object") return [];

    const cfg = raw as Record<string, unknown>;
    const mcpSection: Record<string, unknown> | undefined =
      (cfg.mcpServers as Record<string, unknown>) ??
      ((cfg.tools as Record<string, unknown>)?.mcpServers as Record<string, unknown>) ??
      ((cfg.tools as Record<string, unknown>)?.servers as Record<string, unknown>) ??
      ((cfg.mcp as Record<string, unknown>)?.servers as Record<string, unknown>);

    if (!mcpSection || typeof mcpSection !== "object") return [];

    const mcpToolCounts = countMcpToolsByServer(allTools);

    return Object.entries(mcpSection)
      .filter(([, val]) => val && typeof val === "object")
      .map(([name, val]) => {
        const entry = val as Record<string, unknown>;
        return {
          name,
          description: typeof entry.description === "string" ? entry.description : undefined,
          command: typeof entry.command === "string" ? entry.command : undefined,
          enabled: entry.enabled !== false,
          toolCount: mcpToolCounts.get(name) ?? 0,
        };
      });
  } catch {
    return [];
  }
}

/**
 * 合并 RPC 发现 + 磁盘文件发现 + origin 过滤三路 MCP 列表。
 * 以 name 为 key 去重：磁盘文件条目优先（含 command/args），RPC 条目补充 toolCount。
 */
async function fetchMCPList(allTools: GatewayToolInfo[]): Promise<GatewayMCPInfo[]> {
  const [rpcMcps, fileMcps] = await Promise.all([
    fetchMcpFromRpc(allTools),
    fetchMcpFromConfigFile(),
  ]);

  const mcpToolCounts = countMcpToolsByServer(allTools);
  const seen = new Map<string, GatewayMCPInfo>();

  // 优先放 RPC 条目，文件条目覆盖（文件有 command 等字段）
  for (const m of rpcMcps) {
    seen.set(m.name, { ...m, toolCount: m.toolCount ?? mcpToolCounts.get(m.name) ?? 0 });
  }
  for (const m of fileMcps) {
    const existing = seen.get(m.name);
    seen.set(m.name, {
      ...existing,
      ...m,
      toolCount: m.toolCount ?? existing?.toolCount ?? mcpToolCounts.get(m.name) ?? 0,
    });
  }

  if (seen.size > 0) return [...seen.values()];

  // 兜底：从 allTools 按 origin 分组推断
  if (mcpToolCounts.size === 0) return [];

  return [...mcpToolCounts.entries()].map(([name, count]) => ({
    name,
    enabled: true,
    toolCount: count,
  }));
}

/** 解析 config.get 返回的完整运行时配置，提取关键字段供 UI 展示。 */
export async function fetchGatewayRuntimeConfig(): Promise<GatewayRuntimeConfig> {
  const empty: GatewayRuntimeConfig = {
    gateway: { mode: "", port: 0, bind: "", authMode: "" },
    defaultModel: "",
    providerNames: [],
    providerModels: {},
    workspace: "",
    sandboxMode: "",
    topLevelKeys: [],
  };

  try {
    const client = getGatewayClient();
    if (!client.isHelloOk) return empty;

    const raw = await client.request<unknown>("config.get", {}, { timeoutMs: 5000 });
    if (!raw || typeof raw !== "object") return empty;

    const cfg = raw as Record<string, unknown>;
    empty.topLevelKeys = Object.keys(cfg);

    /* ── gateway 节 ── */
    const gw = cfg.gateway as Record<string, unknown> | undefined;
    if (gw) {
      empty.gateway.mode = typeof gw.mode === "string" ? gw.mode : "";
      empty.gateway.port = typeof gw.port === "number" ? gw.port : 0;
      empty.gateway.bind = typeof gw.bind === "string" ? gw.bind : "";
      const auth = gw.auth as Record<string, unknown> | undefined;
      empty.gateway.authMode = auth && typeof auth.mode === "string" ? auth.mode : "";
    }

    /* ── agents.defaults ── */
    const agents = cfg.agents as Record<string, unknown> | undefined;
    const defaults = agents?.defaults as Record<string, unknown> | undefined;
    if (defaults) {
      const model = defaults.model as Record<string, unknown> | undefined;
      empty.defaultModel = model && typeof model.primary === "string" ? model.primary : "";
      empty.workspace = typeof defaults.workspace === "string" ? defaults.workspace : "";
      const sandbox = defaults.sandbox as Record<string, unknown> | undefined;
      empty.sandboxMode = sandbox && typeof sandbox.mode === "string" ? sandbox.mode : "";
    }

    /* ── models.providers ── */
    const providers = (cfg.models as Record<string, unknown> | undefined)
      ?.providers as Record<string, Record<string, unknown>> | undefined;
    if (providers) {
      for (const [key, val] of Object.entries(providers)) {
        if (!val || typeof val !== "object") continue;
        empty.providerNames.push(key);
        const models = val.models;
        if (Array.isArray(models)) {
          empty.providerModels[key] = models
            .map((m: unknown) =>
              m && typeof m === "object" ? String((m as Record<string, unknown>).id ?? "") : "",
            )
            .filter(Boolean);
        }
      }
    }

    return empty;
  } catch {
    return empty;
  }
}

/** 一次性探测 OpenClaw 网关公开的 tool / skill / MCP 能力 */
export async function discoverGatewayToolsAndSkills(): Promise<GatewayDiscoveryResult> {
  const [toolsFromCatalog, toolsFromEffective, skillStatus] = await Promise.all([
    fetchToolCatalog(),
    fetchToolsEffective(),
    fetchSkillStatus(),
  ]);

  // tools.catalog 优先，回退 tools.effective
  const tools = toolsFromCatalog.length > 0 ? toolsFromCatalog : toolsFromEffective;

  // 技能去重（用 name 做 key）
  const skillMap = new Map<string, GatewaySkillInfo>();
  for (const s of skillStatus) {
    skillMap.set(s.name, s);
  }

  // MCP 服务器列表
  const mcps = await fetchMCPList(tools);

  return {
    tools,
    skills: [...skillMap.values()],
    mcps,
  };
}
