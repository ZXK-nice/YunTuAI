import { useMemo, useState } from "react";
import type { PipelineStep, StepStatus } from "../../types/pipeline-step";
import { useStepStore } from "../../stores/stepStore";

function statusLabel(s: StepStatus): string {
  switch (s) {
    case "pending":
      return "等待";
    case "running":
      return "进行中";
    case "success":
      return "成功";
    case "failed":
      return "失败";
    case "skipped":
      return "跳过";
  }
}

function stepDuration(s: PipelineStep): string {
  if (!s.startedAt) return "—";
  if (!s.endedAt) return s.status === "running" ? "…" : "—";
  const a = new Date(s.startedAt).getTime();
  const b = new Date(s.endedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "—";
  const ms = b - a;
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "success" || status === "skipped") {
    return (
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-success)] text-[10px] font-bold text-white"
        aria-hidden
      >
        ✓
      </div>
    );
  }
  if (status === "running") {
    return (
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] text-[var(--bg-elevated)]"
        aria-hidden
      >
        <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
        </svg>
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-error)] text-[9px] font-bold text-white"
        aria-hidden
      >
        !
      </div>
    );
  }
  return <div className="h-5 w-5 shrink-0 rounded-full border-2 border-[var(--border-default)] bg-[var(--bg-elevated)]" aria-hidden />;
}

export function TaskStepPipeline() {
  const steps = useStepStore((s) => s.steps);
  const activeSendId = useStepStore((s) => s.activeSendId);
  const visibleSteps = useMemo(
    () => (activeSendId ? steps.filter((st) => !st.sendId || st.sendId === activeSendId) : steps),
    [steps, activeSendId],
  );
  const clear = useStepStore((s) => s.clear);
  const [openId, setOpenId] = useState<string | null>(null);

  const hasRunning = useMemo(() => visibleSteps.some((s) => s.status === "running"), [visibleSteps]);

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <div className="flex items-center justify-end gap-2">
        {hasRunning && (
          <button
            type="button"
            onClick={() => {
              useStepStore.getState().finalizeStaleRunningSteps();
            }}
            className="yt-btn-ghost shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
            title="当界面仍显示执行中但流已结束时，可点此收敛状态"
          >
            标为完成
          </button>
        )}
        {visibleSteps.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clear();
              setOpenId(null);
            }}
            className="yt-btn-ghost shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
          >
            清空列表
          </button>
        )}
      </div>

      {visibleSteps.length === 0 ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-center text-xs text-[var(--text-tertiary)]">
          无任务。工具/流水线将在此以时间线展示。
        </div>
      ) : (
        <ol className="relative min-w-0 max-w-full space-y-0 pl-0">
          {visibleSteps.map((st: PipelineStep, idx: number) => {
            const open = openId === st.id;
            const isLast = idx === visibleSteps.length - 1;
            return (
              <li key={st.id} className="relative flex min-w-0 max-w-full gap-3 pb-4 last:pb-0">
                <div className="flex w-5 shrink-0 flex-col items-center">
                  <StepIcon status={st.status} />
                  {!isLast && <div className="mt-1 w-px flex-1 min-h-[0.5rem] bg-[var(--border-subtle)]" />}
                </div>
                <div className="min-w-0 max-w-full flex-1 overflow-hidden">
                  <div className="yt-transition overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)]">
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 rounded-[var(--radius-md)] p-2.5 text-left"
                      onClick={() => setOpenId((v) => (v === st.id ? null : st.id))}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {st.kind === "plan" && (
                            <span className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--brand-color)_12%,var(--bg-elevated))] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--brand-color)]">
                              计划
                            </span>
                          )}
                          {st.parallelGroupId && st.kind === "plan" && (
                            <span className="shrink-0 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--color-warn)_12%,var(--bg-elevated))] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--color-warn)]">
                              并行
                            </span>
                          )}
                          {st.agentId && (
                            <span className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[9px] font-semibold text-white bg-[color-mix(in_oklab,var(--brand-color-end)_80%,var(--brand-color))]">
                              {st.agentName ?? st.agentId.slice(0, 4)}
                            </span>
                          )}
                          <div className="text-[13px] font-medium text-[var(--text-secondary)]">{st.title}</div>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">步骤 · {statusLabel(st.status)}</p>
                        <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">耗时 {stepDuration(st)}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--text-tertiary)]">{st.startedAt}</p>
                      </div>
                    </button>
                    {open && (
                      <div className="min-w-0 border-t border-[var(--border-subtle)] px-2.5 py-2 text-xs text-[var(--text-tertiary)]">
                        <div className="text-[11px] font-medium text-[var(--text-primary)]">详情</div>
                        <pre className="mt-1.5 max-h-32 min-w-0 overflow-auto break-words rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] p-2 text-[10px] leading-relaxed text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                          {st.detail ?? "（无）"}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
