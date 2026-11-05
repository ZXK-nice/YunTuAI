import { memo, useMemo } from "react";
import { useExternalJobWatchStore } from "../../stores/externalJobWatchStore";

type Props = {
  sessionId: string | null;
};

function statusLabel(status: string, ended?: string): string {
  if (ended) {
    if (status === "completed") return "已完成";
    if (status === "partial_failed") return "部分失败";
    if (status === "failed") return "失败";
    if (status === "timeout") return "追踪超时";
    return "已结束";
  }
  if (status === "polling" || status === "running" || status === "pending") return "追踪中";
  return status || "等待";
}

export const ExternalJobWatchBoard = memo(function ExternalJobWatchBoard({ sessionId }: Props) {
  const watches = useExternalJobWatchStore((s) => s.watches);
  const active = useMemo(() => {
    if (!sessionId) return [];
    return watches.filter((w) => w.sessionId === sessionId);
  }, [watches, sessionId]);

  if (active.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_22%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--bg-elevated))] p-3">
      <p className="text-xs font-semibold text-[var(--text-primary)]">AOS 后台任务追踪</p>
      <p className="mt-0.5 mb-2 text-[10px] text-[var(--text-tertiary)]">
        入队后轮询本机 AOS，终态后自动写入对话汇报
      </p>
      <ul className="grid gap-2">
        {active.map((w) => (
          <li
            key={w.id}
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2"
          >
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              {w.parentLabel || "发布任务"}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--text-tertiary)] [overflow-wrap:anywhere]">
              {w.jobId}
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              {statusLabel(w.status, w.endedAt)}
              {w.totalItems != null
                ? ` · ${w.completedItems ?? 0}/${w.totalItems}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
});
