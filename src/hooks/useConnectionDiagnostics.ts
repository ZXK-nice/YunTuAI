import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  buildConnectionDiagnosticsSummary,
  copyTextToClipboard,
} from "../lib/openclaw/connection-diagnostics";
import { getCachedDistributionProfile } from "../lib/openclaw/console-control-stability";
import { fetchGatewayServiceDiagnostic } from "../lib/openclaw/gateway-lifecycle";
import { gatewaySessionCompact } from "../lib/openclaw/console-control";
import { useGatewayStore } from "../stores/gatewayStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";

/** 压缩当前活跃会话上下文（供按钮点击调用，避免在 ChatPanel 订阅整包诊断状态）。 */
export async function compactActiveSessionForUi(): Promise<boolean> {
  const { activeId, sessions, backfillHistoryFromGateway } = useSessionStore.getState();
  const active = activeId ? sessions.find((x) => x.id === activeId) ?? null : null;
  const key = active?.remoteSessionKey?.trim();
  const { connState } = useGatewayStore.getState();
  const showToast = useUiStore.getState().showToast;
  if (!key || connState !== "connected") return false;
  const res = await gatewaySessionCompact(key);
  if (res.ok) {
    showToast("上下文已压缩", "success");
    if (activeId) {
      await backfillHistoryFromGateway(activeId, { reload: true, silent: false });
    }
    return true;
  }
  showToast(res.error ?? "压缩失败", "error");
  return false;
}
/** 汇总网关/会话诊断并支持压缩上下文（侧栏与错误提示共用）。 */
export function useConnectionDiagnostics() {
  const showToast = useUiStore((s) => s.showToast);
  const {
    connState,
    wsUrl,
    lastError,
    serverInfo,
    healthLatencyMs,
    connectionQuality,
    reconnectAttempt,
    gatewayCapabilities,
  } = useGatewayStore(
    useShallow((s) => ({
      connState: s.connState,
      wsUrl: s.wsUrl,
      lastError: s.lastError,
      serverInfo: s.serverInfo,
      healthLatencyMs: s.healthLatencyMs,
      connectionQuality: s.connectionQuality,
      reconnectAttempt: s.reconnectAttempt,
      gatewayCapabilities: s.gatewayCapabilities,
    })),
  );

  const activeId = useSessionStore((s) => s.activeId);
  const active = useSessionStore((s) =>
    s.activeId ? s.sessions.find((x) => x.id === s.activeId) ?? null : null,
  );
  const messageCount = useSessionStore((s) =>
    activeId ? (s.messagesBySession[activeId]?.length ?? 0) : 0,
  );
  const isSending = useSessionStore((s) => s.isSending);
  const syncingHistoryBySession = useSessionStore((s) => s.syncingHistoryBySession);
  const subscriptionHealthBySession = useSessionStore((s) => s.subscriptionHealthBySession);

  const isSyncingHistory = activeId ? Boolean(syncingHistoryBySession[activeId]) : false;

  const buildDiagnosticsText = useCallback(async () => {
    const [profile, serviceDiagnostic] = await Promise.all([
      getCachedDistributionProfile().catch(() => null),
      fetchGatewayServiceDiagnostic().catch(() => null),
    ]);
    return buildConnectionDiagnosticsSummary({
      connState,
      wsUrl,
      lastError,
      serverInfo,
      healthLatencyMs,
      reconnectAttempt,
      connectionQuality,
      capabilities: gatewayCapabilities,
      methodCoverage: gatewayCapabilities?.methodCoverage ?? null,
      activeSession: active
        ? {
            id: active.id,
            title: active.title,
            remoteSessionKey: active.remoteSessionKey,
            messageCount,
            subscriptionHealth: activeId ? subscriptionHealthBySession[activeId] ?? null : null,
            syncingHistory: isSyncingHistory,
          }
        : null,
      distributionProfile: profile,
      serviceDiagnostic,
    });
  }, [
    active,
    activeId,
    connState,
    connectionQuality,
    gatewayCapabilities,
    healthLatencyMs,
    isSyncingHistory,
    lastError,
    messageCount,
    reconnectAttempt,
    serverInfo,
    subscriptionHealthBySession,
    wsUrl,
  ]);

  const copyDiagnostics = useCallback(async () => {
    const text = await buildDiagnosticsText();
    const ok = await copyTextToClipboard(text);
    showToast(ok ? "诊断信息已复制到剪贴板" : "复制失败", ok ? "success" : "error");
  }, [buildDiagnosticsText, showToast]);

  const compactActiveSession = useCallback(async () => compactActiveSessionForUi(), []);

  return {
    connState,
    isSending,
    hasRemoteSession: Boolean(active?.remoteSessionKey?.trim()),
    copyDiagnostics,
    compactActiveSession,
  };
}
