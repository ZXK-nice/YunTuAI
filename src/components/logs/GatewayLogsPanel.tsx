import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchGatewayLogsTail } from "../../lib/openclaw/logs-rpc";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useGatewayStore } from "../../stores/gatewayStore";
import { AuditLogSection } from "./AuditLogSection";

const AUTO_TAIL_INTERVAL_MS = 12_000;

function formatLogsPayload(data: unknown): string {
  if (data === null || data === undefined) return "";
  try {
    return typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function GatewayLogsPanel() {
  const connState = useGatewayStore((s) => s.connState);
  const wsUrl = useGatewayStore((s) => s.wsUrl);
  const gatewayCapabilities = useGatewayStore((s) => s.gatewayCapabilities);

  const [rpcPayload, setRpcPayload] = useState<unknown>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoTail, setAutoTail] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const rpcText = useMemo(() => formatLogsPayload(rpcPayload), [rpcPayload]);

  const filteredText = useMemo(() => {
    if (!filter.trim()) return rpcText;
    const lines = rpcText.split("\n");
    const q = filter.trim().toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q)).join("\n");
  }, [rpcText, filter]);

  const loadTail = useCallback(async (opts?: { silent?: boolean }) => {
    if (inFlightRef.current || connState !== "connected") return;
    inFlightRef.current = true;
    if (!opts?.silent) setRpcLoading(true);
    setRpcError(null);
    try {
      const data = await fetchGatewayLogsTail({});
      setRpcPayload(data);
      setLastFetchedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setRpcError(e instanceof Error ? e.message : String(e));
      if (!opts?.silent) setRpcPayload(null);
    } finally {
      inFlightRef.current = false;
      if (!opts?.silent) setRpcLoading(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState !== "connected" || !autoTail) return;
    void loadTail({ silent: true });
    const timer = window.setInterval(() => {
      void loadTail({ silent: true });
    }, AUTO_TAIL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoTail, connState, loadTail]);

  return (
    <div className="flex min-h-0 flex-col gap-3 text-[var(--text-secondary)]">
      <div>
        <p className="text-sm leading-relaxed">
          <strong className="text-[var(--text-primary)]">运行日志</strong>：连接后自动拉取{" "}
          <code className="rounded bg-[var(--surface-2)] px-1">logs.tail</code>；也可手动刷新。
        </p>
        {gatewayCapabilities?.gatewayVersion && (
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            网关 {gatewayCapabilities.gatewayVersion}
            {gatewayCapabilities.methodCoverage
              ? ` · RPC 覆盖 ${gatewayCapabilities.methodCoverage.coveragePercent}%`
              : null}
          </p>
        )}
      </div>

      {connState !== "connected" && (
        <div className="yt-warn-banner">
          当前未连接 WebSocket（{connState}）。请先前往「软件设置」连接{" "}
          <code className="rounded bg-[var(--surface-2)] px-1">{wsUrl}</code>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={rpcLoading || connState !== "connected"}
            onClick={() => void loadTail()}
            className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {rpcLoading ? "拉取中…" : "立即刷新"}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={autoTail}
              onChange={(e) => setAutoTail(e.target.checked)}
              className="rounded border-[var(--border-subtle)]"
            />
            自动刷新（{AUTO_TAIL_INTERVAL_MS / 1000}s）
          </label>
          {lastFetchedAt && (
            <span className="text-[10px] text-[var(--text-tertiary)]">上次 {lastFetchedAt}</span>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="关键词过滤（客户端）"
            className="min-w-[200px] flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
          />
        </div>
        {rpcError && (
          <pre className="mt-3 whitespace-pre-wrap text-xs text-rose-300">{rpcError}</pre>
        )}
        {filteredText ? (
          <pre className="mt-3 max-h-[min(420px,50vh)] overflow-auto rounded-lg bg-black/25 p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {filteredText}
          </pre>
        ) : (
          !rpcError && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">
              {connState === "connected"
                ? autoTail
                  ? "等待首次自动拉取…"
                  : "点击「立即刷新」加载。"
                : "连接网关后可查看运行日志。"}
            </p>
          )
        )}
      </div>

      <AuditLogSection />

      <div className="rounded-xl border border-dashed border-[var(--border-subtle)] p-4 text-xs leading-relaxed">
        <div className="font-medium text-[var(--text-primary)]">CLI 日志 / 状态</div>
        <p className="mt-1">
          进程状态可在「仪表盘」用 <code className="rounded bg-black/20 px-1">gateway status</code> 等命令查看；完整文件日志请在终端使用配套日志命令。
        </p>
        {!isTauriRuntime() && (
          <p className="mt-2 text-amber-200/90">Tauri 桌面版下可从仪表盘调用 CLI；浏览器预览不可用。</p>
        )}
      </div>
    </div>
  );
}
