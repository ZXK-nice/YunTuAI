import { memo, useCallback, useEffect, useState } from "react";
import { cliGatewaySupervisorRestart } from "../../lib/openclaw/cli-bridge";
import { fetchOpenClawDataRoots, switchOpenClawDataRoot, type OpenClawDataRootsReport } from "../../lib/openclaw/data-roots-bridge";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { formatUserFacingPath } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

export const OpenClawDataRootsBanner = memo(function OpenClawDataRootsBanner() {
  const showToast = useUiStore((s) => s.showToast);
  const [report, setReport] = useState<OpenClawDataRootsReport | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    void fetchOpenClawDataRoots().then(setReport);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    reload();
  }, [reload]);

  const switchTo = useCallback(
    async (path: string, label: string) => {
      setBusy(true);
      try {
        const next = await switchOpenClawDataRoot(path);
        if (next) setReport(next);
        showToast(`已切换到 ${label}，正在重启本机服务…`, "info");
        await cliGatewaySupervisorRestart();
        await connectWithFeedback("切换数据目录后重连", { skipPrepare: true }).catch(() => undefined);
        showToast("数据目录已切换，请确认技能列表是否一致。", "success");
        reload();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [reload, showToast],
  );

  if (!report?.hasDuplicates) return null;

  const others = report.entries.filter((e) => !e.isActive && e.hasOpenClawJson);
  if (others.length === 0) return null;

  const richest = [...others].sort((a, b) => b.skillDirCount - a.skillDirCount)[0];

  return (
    <div className="yt-warn-banner rounded-xl p-4 text-xs leading-relaxed">
      <div className="font-medium">检测到多套本机服务数据目录</div>
      <p className="mt-1">
        当前使用：<span className="font-mono text-[11px]">{formatUserFacingPath(report.activePath)}</span>
        {(() => {
          const active = report.entries.find((e) => e.isActive);
          return active && active.skillDirCount > 0
            ? `（${active.skillDirCount} 个技能）`
            : "";
        })()}
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1 opacity-90">
        {others.map((e) => (
          <li key={e.path}>
            {e.label}：<span className="font-mono text-[11px]">{formatUserFacingPath(e.path)}</span>
            {e.skillDirCount > 0 ? `（${e.skillDirCount} 个技能）` : ""}
            {richest && e.path === richest.path && e.skillDirCount > (report.entries.find((x) => x.isActive)?.skillDirCount ?? 0)
              ? " · 技能更多，建议切换"
              : ""}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {richest ? (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg border border-[var(--warn-border)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] px-3 py-1.5 text-xs font-medium hover:bg-[color-mix(in_oklab,var(--color-warn)_18%,transparent)] disabled:opacity-50"
            onClick={() => void switchTo(richest.path, richest.label)}
          >
            {busy ? "切换中…" : `切换到技能更多的「${richest.label}」`}
          </button>
        ) : null}
        {others.map((e) => (
          <button
            key={`sw-${e.path}`}
            type="button"
            disabled={busy}
            className="rounded-lg border border-[var(--warn-border)] px-3 py-1.5 text-[11px] hover:bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] disabled:opacity-50"
            onClick={() => void switchTo(e.path, e.label)}
          >
            使用 {e.label}
          </button>
        ))}
      </div>
      <p className="mt-2 opacity-80">
        切换后会重启本机服务。建议只长期保留一套目录，避免技能「在这套有、那套没有」。
      </p>
    </div>
  );
});

