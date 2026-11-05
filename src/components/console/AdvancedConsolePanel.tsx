import { PRODUCT_NAME } from "../../lib/product-brand";
import { invokeAuthed } from "../../lib/tauri-invoke";
import { useCallback, useEffect, useState } from "react";
import { appendAuditEvent } from "../../lib/audit-bridge";
import { getGatewayClient } from "../../lib/openclaw/gateway-runtime";
import { isTauriRuntime } from "../../lib/tauri-env";
import { humanizeGatewayConn } from "../../lib/ui/gateway-ui";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import { OPENCLAW_BASE_GATEWAY_METHODS } from "../../lib/openclaw/gateway-methods-known";
import { formatUserFacingPath, sanitizeUserFacingCopy } from "../../lib/product-copy";

const WS_PLACEHOLDER = `{\n  "method": "sessions.list",\n  "params": {}\n}`;

function trimOutput(s: string, max = 24_000) {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated)`;
}

type Props = {
  /** 嵌入 网关 控制台 RPC 分区时使用，隐藏外层标题块 */
  embedded?: boolean;
};

export function AdvancedConsolePanel({ embedded }: Props = {}) {
  const showToast = useUiStore((s) => s.showToast);
  const connState = useGatewayStore((s) => s.connState) as GatewayConnStateWord;
  const connHint = humanizeGatewayConn(connState);

  const [wsJson, setWsJson] = useState("");
  const [wsConfirm, setWsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [openclawDir, setOpenclawDir] = useState<string | null>(null);
  const [methodTplKey, setMethodTplKey] = useState(0);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setOpenclawDir("（浏览器预览模式无本机路径）");
      return;
    }
    invokeAuthed<{ dir: string; exists: boolean }>("openclaw_dir_status")
      .then((s) => {
        if (!s) return;
        setOpenclawDir(s.exists ? s.dir : `${s.dir}（尚未创建）`);
      })
      .catch(() => setOpenclawDir("无法读取路径"));
  }, []);

  const pushOut = useCallback((title: string, body: string) => {
    const stamp = new Date().toLocaleString();
    setOutput((prev) => `${prev}\n\n--- ${title} @ ${stamp} ---\n${trimOutput(body)}`.trimStart());
  }, []);

  const onSendWs = async () => {
    if (!wsConfirm) {
      showToast("请先勾选确认：您了解直接向本地服务发送 RPC 的风险。", "info");
      return;
    }
    const text = wsJson.trim();
    if (!text) return;
    setBusy(true);
    try {
      void appendAuditEvent("advanced", "ws_rpc_attempt", text.slice(0, 4000));
      const res = await getGatewayClient().flexibleRequest(text, { timeoutMs: 120_000 });
      const pretty = typeof res === "string" ? res : JSON.stringify(res, null, 2);
      pushOut("WebSocket 响应", pretty);
    } catch (e) {
      pushOut("WebSocket 错误", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "flex flex-col gap-4" : "mx-auto flex max-w-4xl flex-col gap-6"}>
      {!embedded ? (
        <>
          <div className="rounded-xl border border-[color-mix(in_oklab,var(--color-warn)_45%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_10%,var(--bg-elevated))] px-4 py-3 text-xs leading-relaxed">
            <p className="font-medium text-[var(--text-primary)]">高级控制台</p>
            <p className="mt-1 text-[var(--text-secondary)]">
              仅 WebSocket RPC 调试。本机服务启停请在「软件设置 → 本机服务」或「仪表盘」中由 {PRODUCT_NAME} 监管操作。
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-4 py-3 text-xs text-[var(--text-secondary)]">
            <span className="text-[var(--text-primary)]">服务：</span>
            {connHint}
            <span className="mx-2">|</span>
            <span className="text-[var(--text-primary)]">服务数据目录：</span>
            {formatUserFacingPath(openclawDir)}
          </div>
        </>
      ) : null}

      <section className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] p-4">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">WebSocket RPC（原始 JSON）</h3>
        <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <select
            key={methodTplKey}
            defaultValue=""
            disabled={busy}
            aria-label="快速填入 RPC 方法"
            onChange={(e) => {
              const m = e.target.value;
              if (m) {
                setWsJson(JSON.stringify({ method: m, params: {} }, null, 2));
                setMethodTplKey((k) => k + 1);
              }
            }}
            className="max-w-full flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-[11px]"
          >
            <option value="">快速填入方法…</option>
            {OPENCLAW_BASE_GATEWAY_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={wsJson}
          onChange={(e) => setWsJson(e.target.value)}
          placeholder={WS_PLACEHOLDER}
          rows={8}
          disabled={busy}
          aria-label="WebSocket RPC 请求体"
          className="mt-3 w-full resize-y rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[11px]"
        />
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input type="checkbox" checked={wsConfirm} onChange={(e) => setWsConfirm(e.target.checked)} className="mt-0.5" />
          <span>我已了解直接向本机服务发送调试请求的风险。</span>
        </label>
        <button
          type="button"
          disabled={busy || connState !== "connected" || !wsJson.trim()}
          onClick={() => void onSendWs()}
          className="mt-3 rounded-lg bg-[var(--brand-color)] px-4 py-2 text-xs font-medium text-white disabled:opacity-45"
        >
          {busy ? "处理中…" : "发送 RPC"}
        </button>
      </section>

      <section className="rounded-xl border border-[var(--border-subtle)] p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">输出</h3>
          <button type="button" onClick={() => setOutput("")} className="text-xs text-[var(--text-secondary)]">
            清空
          </button>
        </div>
        <pre className="mt-2 max-h-[min(50vh,420px)] overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-3 font-mono text-[11px]">
          {output ? sanitizeUserFacingCopy(output) : "尚无输出。"}
        </pre>
      </section>
    </div>
  );
}
