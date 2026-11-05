/**
 * OpenClaw 全能力控制台 — 按域封装的 Gateway RPC 调用。
 */

import { getGatewayClient } from "./gateway-runtime";

export type ConsoleRpcResult = {
  method: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  at: string;
};

async function call(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<ConsoleRpcResult> {
  const at = new Date().toISOString();
  const client = getGatewayClient();
  if (!client.isHelloOk) {
    return { method, ok: false, error: "请先连接 Gateway", at };
  }
  try {
    const data = await client.request(method, params, { timeoutMs });
    return { method, ok: true, data, at };
  } catch (e) {
    return { method, ok: false, error: e instanceof Error ? e.message : String(e), at };
  }
}

export type ConsoleSectionId =
  | "overview"
  | "agents"
  | "channels"
  | "cron"
  | "nodes"
  | "memory"
  | "usage"
  | "config"
  | "skills"
  | "sessions"
  | "compaction"
  | "tts"
  | "exec"
  | "rpc";

export type ConsoleSectionDef = {
  id: ConsoleSectionId;
  label: string;
  description: string;
};

export const OPENCLAW_CONSOLE_SECTIONS: ConsoleSectionDef[] = [
  { id: "overview", label: "概览", description: "健康、状态与网关身份" },
  { id: "agents", label: "Agent", description: "编辑、删除 Agent" },
  { id: "channels", label: "渠道", description: "消息渠道连接状态" },
  { id: "cron", label: "定时", description: "Cron 任务列表与运行记录" },
  { id: "nodes", label: "节点", description: "配对节点与设备" },
  { id: "memory", label: "内存", description: "Memory doctor 诊断" },
  { id: "usage", label: "用量", description: "Token 用量与费用" },
  { id: "config", label: "配置", description: "运行时配置查看与补丁" },
  { id: "skills", label: "技能", description: "已安装技能状态" },
  { id: "sessions", label: "会话", description: "网关侧会话列表" },
  { id: "compaction", label: "压缩", description: "会话分支与恢复" },
  { id: "tts", label: "语音", description: "TTS 与语音唤醒" },
  { id: "exec", label: "审批", description: "Exec 审批策略" },
  { id: "rpc", label: "RPC", description: "原始 JSON 调试" },
];

export async function fetchConsoleOverview(): Promise<ConsoleRpcResult[]> {
  return Promise.all([
    call("health", {}),
    call("status", {}),
    call("gateway.identity.get", {}),
    call("usage.status", {}),
  ]);
}

export async function fetchConsoleChannels(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("channels.status", {})]);
}

export async function fetchConsoleCron(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("cron.status", {}), call("cron.list", {})]);
}

export async function fetchConsoleNodes(): Promise<ConsoleRpcResult[]> {
  return Promise.all([
    call("node.list", {}),
    call("node.pair.list", {}),
    call("device.pair.list", {}),
  ]);
}

export async function fetchConsoleMemory(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("doctor.memory.status", {})]);
}

export async function fetchConsoleUsage(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("usage.status", {}), call("usage.cost", {})]);
}

export async function fetchConsoleConfig(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("config.get", {}), call("config.schema", {})]);
}

export async function fetchConsoleSkills(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("skills.status", {}), call("tools.catalog", {})]);
}

export async function fetchConsoleSessions(): Promise<ConsoleRpcResult[]> {
  return Promise.all([call("sessions.list", { limit: 50 })]);
}

export async function fetchConsoleSection(section: ConsoleSectionId): Promise<ConsoleRpcResult[]> {
  switch (section) {
    case "overview":
      return fetchConsoleOverview();
    case "agents":
      return [];
    case "channels":
      return fetchConsoleChannels();
    case "cron":
      return fetchConsoleCron();
    case "nodes":
      return fetchConsoleNodes();
    case "memory":
      return fetchConsoleMemory();
    case "usage":
      return fetchConsoleUsage();
    case "config":
      return fetchConsoleConfig();
    case "skills":
      return fetchConsoleSkills();
    case "sessions":
      return fetchConsoleSessions();
    case "compaction":
    case "tts":
    case "exec":
      return [];
    case "rpc":
      return [];
    default:
      return [];
  }
}

export function formatRpcResultForDisplay(result: ConsoleRpcResult): string {
  if (!result.ok) return result.error ?? "未知错误";
  if (typeof result.data === "string") return result.data;
  try {
    return JSON.stringify(result.data, null, 2);
  } catch {
    return String(result.data);
  }
}
