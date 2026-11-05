/**
 * YunTuAI 已集成的 Gateway RPC 方法清单（产品路径 + 控制台写操作 + 诊断）。
 * 用于连接后探测「本机网关是否暴露我们依赖的方法」。
 */

import { sanitizeUserFacingCopy } from "../product-copy";

export type MethodCoverageReport = {
  availableCount: number;
  integratedCount: number;
  integratedPresentCount: number;
  coveragePercent: number;
  missingIntegrated: string[];
  gatewayVersion: string | null;
};

/** 产品聊天 / 会话 / 审批主路径 */
const PRODUCT_METHODS = [
  "sessions.create",
  "sessions.send",
  "chat.send",
  "agent.wait",
  "sessions.subscribe",
  "sessions.messages.subscribe",
  "sessions.patch",
  "chat.history",
  "chat.abort",
  "agents.create",
  "agents.list",
  "skills.search",
  "skills.install",
  "exec.approval.resolve",
  "plugin.approval.resolve",
  "exec.approval.list",
  "plugin.approval.list",
  "agents.files.get",
  "agents.files.set",
  "models.list",
  "config.get",
  "health",
  "status",
  "list_methods",
] as const;

/** OpenClaw 控制台已封装写/读操作 */
const CONSOLE_METHODS = [
  "gateway.identity.get",
  "usage.status",
  "usage.cost",
  "channels.status",
  "channels.logout",
  "cron.list",
  "cron.add",
  "cron.update",
  "cron.run",
  "cron.remove",
  "node.pair.list",
  "node.pair.approve",
  "node.pair.reject",
  "node.list",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.pair.remove",
  "doctor.memory.status",
  "doctor.memory.repairDreamingArtifacts",
  "config.patch",
  "config.apply",
  "config.schema",
  "agents.update",
  "agents.delete",
  "sessions.list",
  "sessions.reset",
  "sessions.delete",
  "sessions.compact",
  "sessions.compaction.list",
  "sessions.compaction.get",
  "sessions.compaction.branch",
  "sessions.compaction.restore",
  "skills.status",
  "skills.reload",
  "skills.update",
  "tools.catalog",
  "update.run",
  "tts.status",
  "tts.enable",
  "tts.disable",
  "tts.setProvider",
  "voicewake.get",
  "voicewake.set",
  "exec.approvals.get",
  "exec.approvals.set",
  "logs.tail",
] as const;

export const YUNTUAI_INTEGRATED_GATEWAY_METHODS: readonly string[] = [
  ...new Set([...PRODUCT_METHODS, ...CONSOLE_METHODS]),
];

function normMethod(m: string): string {
  return m.trim().toLowerCase();
}

export function extractGatewayMethodsList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((m): m is string => typeof m === "string");
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const list = r.methods ?? r.list;
    if (Array.isArray(list)) {
      return list.filter((m): m is string => typeof m === "string");
    }
  }
  return [];
}

export function extractGatewayVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const candidates = [r.version, r.openclawVersion, r.gatewayVersion, r.build];
  let found: string | null = null;
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) {
      found = c.trim();
      break;
    }
  }
  if (!found) {
    const nested = r.identity ?? r.gateway;
    if (nested && typeof nested === "object") {
      const n = nested as Record<string, unknown>;
      if (typeof n.version === "string" && n.version.trim()) found = n.version.trim();
    }
  }
  return found ? sanitizeUserFacingCopy(found) : null;
}

export function computeMethodCoverage(
  availableMethods: string[],
  gatewayVersion: string | null = null,
): MethodCoverageReport {
  const available = new Set(availableMethods.map(normMethod));
  const missingIntegrated = YUNTUAI_INTEGRATED_GATEWAY_METHODS.filter(
    (m) => !available.has(normMethod(m)),
  );
  const integratedPresentCount = YUNTUAI_INTEGRATED_GATEWAY_METHODS.length - missingIntegrated.length;
  const integratedCount = YUNTUAI_INTEGRATED_GATEWAY_METHODS.length;
  const coveragePercent =
    integratedCount === 0 ? 0 : Math.round((integratedPresentCount / integratedCount) * 100);

  return {
    availableCount: availableMethods.length,
    integratedCount,
    integratedPresentCount,
    coveragePercent,
    missingIntegrated,
    gatewayVersion,
  };
}
