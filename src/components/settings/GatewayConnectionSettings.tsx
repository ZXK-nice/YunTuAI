import { memo } from "react";
import { useShallow } from "zustand/react/shallow";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { humanizeGatewayConn } from "../../lib/ui/gateway-ui";
import { isTauriRuntime } from "../../lib/tauri-env";
import { removeItem } from "../../lib/safeStorage";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { useConnectionDiagnostics } from "../../hooks/useConnectionDiagnostics";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useOwnerStore } from "../../stores/ownerStore";
import { useUiStore } from "../../stores/uiStore";

export const GatewayConnectionSettings = memo(function GatewayConnectionSettings() {
  const showToast = useUiStore((s) => s.showToast);
  const { copyDiagnostics } = useConnectionDiagnostics();
  const {
    wsUrl,
    token,
    connState,
    lastError,
    serverInfo,
    autoReconnect,
    setWsUrl,
    setToken,
    setAutoReconnect,
    autoRemediateOpenClaw,
    setAutoRemediateOpenClaw,
    stallWatchdogEnabled,
    setStallWatchdogEnabled,
    gatewayCapabilities,
    disconnect,
    loadGatewayPrefs,
    reconnectAttempt,
  } = useGatewayStore(
    useShallow((s) => ({
      wsUrl: s.wsUrl,
      token: s.token,
      connState: s.connState as GatewayConnStateWord,
      lastError: s.lastError,
      serverInfo: s.serverInfo,
      autoReconnect: s.autoReconnect,
      setWsUrl: s.setWsUrl,
      setToken: s.setToken,
      setAutoReconnect: s.setAutoReconnect,
      autoRemediateOpenClaw: s.autoRemediateOpenClaw,
      setAutoRemediateOpenClaw: s.setAutoRemediateOpenClaw,
      stallWatchdogEnabled: s.stallWatchdogEnabled,
      setStallWatchdogEnabled: s.setStallWatchdogEnabled,
      gatewayCapabilities: s.gatewayCapabilities,
      disconnect: s.disconnect,
      loadGatewayPrefs: s.loadGatewayPrefs,
      reconnectAttempt: s.reconnectAttempt,
    })),
  );
  const ownerUnlocked = useOwnerStore((s) => s.unlocked || Boolean(s.devBypass));

  return (
    <>
      {gatewayCapabilities?.detectedAt ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
          <div className="font-medium text-[var(--text-primary)]">本机服务能力（已连接时探测）</div>
          <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
            Agent {gatewayCapabilities.supportsAgentsList ? "✓" : "—"} · 会话{" "}
            {gatewayCapabilities.supportsSessionsList ? "✓" : "—"} · 工具{" "}
            {gatewayCapabilities.supportsTools ? "✓" : "—"}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="font-medium text-[var(--text-primary)]">本机服务连接</div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {ownerUnlocked
            ? "Owner 解锁后可修改 WebSocket 地址与 Token。"
            : "连接由系统自动维护；下方可手动重连，高级参数需 Owner 解锁。"}
        </p>
        {ownerUnlocked ? (
          <>
            <label className="mt-3 block text-xs text-[var(--text-secondary)]">WebSocket 地址</label>
            <input
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-primary)]"
            />
            <label className="mt-3 block text-xs text-[var(--text-secondary)]">Token</label>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text-primary)]"
            />
          </>
        ) : (
          <div className="mt-3 space-y-1 text-xs text-[var(--text-secondary)]">
            <div>
              地址：<code className="rounded bg-black/20 px-1">{wsUrl}</code>
            </div>
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={autoReconnect} onChange={(e) => setAutoReconnect(e.target.checked)} />
          断线后自动重连
        </label>
        {isTauriRuntime() && (
          <>
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={autoRemediateOpenClaw}
                onChange={(e) => setAutoRemediateOpenClaw(e.target.checked)}
              />
              连接失败时自动尝试重启本机服务
            </label>
            <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={stallWatchdogEnabled}
                onChange={(e) => setStallWatchdogEnabled(e.target.checked)}
              />
              已连接时定时 health 检测，异常时自动恢复
            </label>
          </>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              removeItem("yuntuai.gateway.tokenOverride");
              void loadGatewayPrefs().then(() => {
                showToast("已从服务数据目录 .env 重新加载连接参数", "info");
                void connectWithFeedback("重新加载参数后连接");
              });
            }}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-glass)]"
          >
            从 .env 重新加载
          </button>
          {ownerUnlocked && (
            <button
              type="button"
              onClick={() => {
                removeItem("yuntuai.gateway.wsUrl");
                removeItem("yuntuai.gateway.tokenOverride");
                void loadGatewayPrefs().then(() => showToast("已恢复 .env 默认连接参数", "info"));
              }}
              className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-glass)]"
            >
              恢复默认连接参数
            </button>
          )}
          <button
            type="button"
            onClick={() => void connectWithFeedback("手动重连本机服务")}
            disabled={connState === "connecting"}
            className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {connState === "connecting" ? "连接中…" : "连接服务"}
          </button>
          <button
            type="button"
            onClick={() => disconnect()}
            disabled={connState === "disconnected"}
            className="yt-btn-svc disabled:opacity-50"
          >
            断开连接
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            className="yt-btn-svc"
          >
            复制诊断
          </button>
        </div>
        <div className="mt-2 text-xs text-[var(--text-secondary)]">
          状态：<span className="text-[var(--text-primary)]">{humanizeGatewayConn(connState)}</span>
          {reconnectAttempt > 0 ? (
            <span className="ml-2 text-[var(--text-muted)]">已重试 {reconnectAttempt} 次</span>
          ) : null}
          {lastError ? (
            <div className="mt-2 space-y-1 rounded-lg border border-[color-mix(in_oklab,var(--color-error)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-error)_8%,transparent)] p-2 text-[var(--color-error)]">
              <p>{sanitizeUserFacingCopy(lastError)}</p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                建议：点「连接服务」重试 → 上方「同步精选技能 / 模块管理」→ 若仍失败，点「复制诊断」发给支持。
              </p>
            </div>
          ) : null}
        </div>
        {serverInfo ? (
          <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/20 p-2 text-[10px]">{sanitizeUserFacingCopy(serverInfo)}</pre>
        ) : null}
      </div>
    </>
  );
});

