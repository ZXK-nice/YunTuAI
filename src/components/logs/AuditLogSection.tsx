import { useCallback, useEffect, useState } from "react";
import {
  downloadTextFile,
  exportAuditJson,
  fetchAuditList,
  type AuditLogRow,
} from "../../lib/audit-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";

export function AuditLogSection() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setLoading(true);
    try {
      const data = await fetchAuditList(150);
      setRows(data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onExport() {
    const json = await exportAuditJson();
    if (json) {
      const name = `yuntuai-audit-${new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")}.json`;
      downloadTextFile(name, json);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--text-primary)]">操作审计</div>
          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            记录本机服务相关命令行调用结果（stdout/stderr 摘要），存于本地 SQLite。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={loading || !isTauriRuntime()}
            onClick={() => void load()}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-glass)] disabled:opacity-50"
          >
            {loading ? "加载中…" : "刷新列表"}
          </button>
          <button
            type="button"
            disabled={!isTauriRuntime()}
            onClick={() => void onExport()}
            className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            导出 JSON
          </button>
        </div>
      </div>

      {!isTauriRuntime() ? (
        <p className="mt-3 text-xs text-amber-200/90">仅在 Tauri 桌面版可用。</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">
          暂无记录。在「仪表盘」执行 gateway 相关命令后会在此出现。
        </p>
      ) : (
        <ul className="mt-3 max-h-64 space-y-2 overflow-auto text-xs">
          {rows.map((r) => {
            const open = expanded === r.id;
            const preview = r.detail.length > 160 && !open ? `${r.detail.slice(0, 160)}…` : r.detail;
            return (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-black/15 px-2 py-2"
              >
                <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="text-[var(--text-primary)]">{r.createdAt}</span>
                  <span className="rounded bg-white/5 px-1">{r.category}</span>
                  <span>{r.action}</span>
                </div>
                <button
                  type="button"
                  className="mt-1 w-full text-left font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]"
                  onClick={() => setExpanded((v) => (v === r.id ? null : r.id))}
                >
                  {preview}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
