/**
 * 汇总网关连接、会话与能力状态，供用户复制给支持或自查。
 */

import type { GatewayCapabilities } from "./gateway-capabilities";
import type { MethodCoverageReport } from "./gateway-method-coverage";
import { sanitizeUserFacingCopy } from "../product-copy";
import { PRODUCT_NAME } from "../product-brand";
import { getLastCliBridgeFailure } from "./cli-bridge";
import type { GatewayServiceDiagnosticSnapshot } from "./gateway-lifecycle";
import { formatLifecycleDiagnosticLine } from "./gateway-lifecycle";

export type ConnectionDiagnosticsInput = {
  connState: string;
  wsUrl: string;
  lastError: string | null;
  serverInfo: string | null;
  healthLatencyMs: number | null;
  reconnectAttempt: number;
  connectionQuality: string;
  capabilities: GatewayCapabilities | null;
  methodCoverage: MethodCoverageReport | null;
  activeSession: {
    id: string;
    title: string;
    remoteSessionKey: string | null;
    messageCount: number;
    subscriptionHealth: string | null;
    syncingHistory: boolean;
  } | null;
  distributionProfile: string | null;
  serviceDiagnostic?: GatewayServiceDiagnosticSnapshot | null;
};

export function buildConnectionDiagnosticsSummary(input: ConnectionDiagnosticsInput): string {
  const lines: string[] = [
    `=== ${PRODUCT_NAME} 本机服务连接诊断 ===`,
    `时间: ${new Date().toISOString()}`,
  ];

  if (input.distributionProfile) {
    lines.push(`分发档: ${input.distributionProfile}`);
  }

  lines.push(
    `WebSocket: ${input.wsUrl}`,
    `连接状态: ${input.connState}`,
    `连接质量: ${input.connectionQuality}`,
  );

  if (input.healthLatencyMs != null) {
    lines.push(`最近 health 延迟: ${input.healthLatencyMs}ms`);
  }
  if (input.reconnectAttempt > 0) {
    lines.push(`重连尝试次数: ${input.reconnectAttempt}`);
  }
  if (input.serverInfo) {
    lines.push(`服务信息: ${sanitizeUserFacingCopy(input.serverInfo)}`);
  }
  if (input.lastError) {
    lines.push(`最近错误: ${sanitizeUserFacingCopy(input.lastError)}`);
  }

  const ipcFail = getLastCliBridgeFailure();
  if (ipcFail) {
    lines.push(
      `最近 IPC 失败: ${ipcFail.cmd} · ${sanitizeUserFacingCopy(ipcFail.message)} · ${new Date(ipcFail.at).toISOString()}`,
    );
  }

  const svc = input.serviceDiagnostic;
  if (svc) {
    lines.push(
      "",
      "--- 本机服务监管（Rust 单一真相源）---",
      formatLifecycleDiagnosticLine(svc.lifecycle),
      `数据目录: ${svc.dataDir ?? "—"}`,
      `监听端口: ${svc.listenPort}`,
      `需 provision: ${svc.provisionNeeded ? "是" : "否"}`,
      `运行时可用的: ${svc.runtimeAvailable ? "是" : "否"}`,
      `监管 PID: ${svc.lifecycle.supervisor.pid ?? "—"}`,
      `进程存活: ${svc.lifecycle.processAlive ? "是" : "否"}`,
      `端口可达: ${svc.lifecycle.portReachable ? "是" : "否"}`,
      `外部冲突: ${svc.lifecycle.externalConflict ? "是" : "否"}`,
    );
  }

  const caps = input.capabilities;
  if (caps?.detectedAt) {
    lines.push(
      "",
      "--- 网关能力 ---",
      `Agent 列表: ${caps.supportsAgentsList ? "是" : "否"} (${caps.agentCount})`,
      `会话列表: ${caps.supportsSessionsList ? "是" : "否"}`,
      `chat.history: ${caps.supportsChatHistory ? "是" : "否"}`,
      `工具目录: ${caps.supportsTools ? "是" : "否"}`,
      `日志 tail: ${caps.supportsLogs ? "是" : "否"}`,
    );
  }

  const cov = input.methodCoverage;
  if (cov) {
    lines.push(
      "",
      "--- RPC 集成覆盖 ---",
      `网关版本: ${cov.gatewayVersion ?? "未知"}`,
      `可用方法数: ${cov.availableCount}`,
      `已集成方法: ${cov.integratedPresentCount}/${cov.integratedCount} (${cov.coveragePercent}%)`,
    );
    if (cov.missingIntegrated.length > 0) {
      const sample = cov.missingIntegrated.slice(0, 12);
      lines.push(`缺失集成依赖: ${sample.join(", ")}${cov.missingIntegrated.length > 12 ? " …" : ""}`);
    }
  }

  const sess = input.activeSession;
  if (sess) {
    lines.push(
      "",
      "--- 当前会话 ---",
      `本地 ID: ${sess.id}`,
      `标题: ${sess.title}`,
      `remoteSessionKey: ${sess.remoteSessionKey ?? "(未同步)"}`,
      `本地消息数: ${sess.messageCount}`,
      `订阅健康: ${sess.subscriptionHealth ?? "—"}`,
      `历史同步中: ${sess.syncingHistory ? "是" : "否"}`,
    );
  } else {
    lines.push("", "--- 当前会话 ---", "(无选中会话)");
  }

  lines.push("", "=== 诊断结束 ===");
  return sanitizeUserFacingCopy(lines.join("\n"));
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
