import { memo, useMemo, useState } from "react";
import type { StepStatus } from "../../types/pipeline-step";
import { useParallelSubtaskStore } from "../../stores/parallelSubtaskStore";
import {
  isParallelSubtaskEnabled,
  persistParallelSubtaskEnabled,
} from "../../lib/parallel-subtask-prefs";
import { useUiStore } from "../../stores/uiStore";

function statusLabel(s: StepStatus): string {
  switch (s) {
    case "pending":
      return "等待";
    case "running":
      return "执行中";
    case "success":
      return "完成";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
  }
}

function SubtaskIcon({ status }: { status: StepStatus }) {
  if (status === "success") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-success)] text-[8px] font-bold text-white">
        ✓
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--brand-color)]">
        <svg className="h-2 w-2 animate-spin text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--color-error)] text-[8px] font-bold text-white">
        !
      </span>
    );
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)]" />;
}

type Props = {
  sessionId: string | null;
};

export const ParallelSubtaskBoard = memo(function ParallelSubtaskBoard({ sessionId }: Props) {
  const runs = useParallelSubtaskStore((s) => s.runs);
  const showToast = useUiStore((s) => s.showToast);
  const [enabled, setEnabled] = useState(() => isParallelSubtaskEnabled());
  const activeRun = useMemo(() => {
    if (!sessionId) return null;
    return runs.find((r) => r.sessionId === sessionId) ?? null;
  }, [runs, sessionId]);

  if (!activeRun || activeRun.items.length === 0) return null;

  const toggleEnabled = () => {
    const next = !enabled;
    persistParallelSubtaskEnabled(next);
    setEnabled(next);
    showToast(
      next
        ? "已开启并行子 Agent（后续任务将后台并行执行）"
        : "已关闭并行子 Agent，后续不再自动多开会话",
      "info",
    );
  };

  const done = activeRun.items.filter((it) => it.status === "success" || it.status === "failed").length;
  const running = activeRun.items.some((it) => it.status === "running");
  const allDone = done === activeRun.items.length && !running;

  return (
    <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--brand-color)_25%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--brand-color)_6%,var(--bg-elevated))] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">并行子 Agent</p>
          <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
            {activeRun.parentLabel || "后台并行任务"} · {done}/{activeRun.items.length}
            {allDone ? " 已全部结束" : running ? " 执行中" : " 排队中"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-warn)_15%,var(--bg-elevated))] px-2 py-0.5 text-[9px] font-semibold text-[var(--color-warn)]">
            {enabled ? "多 Agent" : "已关闭"}
          </span>
          <button
            type="button"
            onClick={toggleEnabled}
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
          >
            {enabled ? "关闭" : "开启"}
          </button>
        </div>
      </div>
      <p className="mb-2 text-[9px] leading-relaxed text-[var(--text-tertiary)]">
        每个子任务独立使用一次远程会话并消耗模型 tokens；无需多路并行时可在右侧关闭。
      </p>
      <ul className="grid gap-2">
        {activeRun.items.map((it) => (
          <li
            key={it.id}
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2"
          >
            <div className="flex items-start gap-2">
              <SubtaskIcon status={it.status} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--text-secondary)]">{it.title}</p>
                <p className="text-[10px] text-[var(--text-tertiary)]">{statusLabel(it.status)}</p>
                {it.excerpt ? (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--text-muted)] [overflow-wrap:anywhere]">
                    {it.excerpt}
                  </p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});
