import type { ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chatGetOutputDir } from "../../lib/chat/chat-files-bridge";
import { openClawWorkspacePath } from "../../lib/openclaw/cli-bridge";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import {
  getTaskDeliverySummary,
  subscribeTaskDelivery,
} from "../../lib/openclaw/task-delivery";
import { loadReplayStepsForSession } from "../../lib/openclaw/gateway-event-replay";
import { rerunTask } from "../../lib/openclaw/task-rerun";
import { isTauriRuntime } from "../../lib/tauri-env";
import type { LocalMessageRow } from "../../stores/sessionStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useStepStore } from "../../stores/stepStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { useConnectionDiagnostics } from "../../hooks/useConnectionDiagnostics";
import { AgentAvatar } from "../ui/AgentAvatar";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { TaskStepPipeline } from "../steps/TaskStepPipeline";
import { ParallelSubtaskBoard } from "../steps/ParallelSubtaskBoard";
import { ExternalJobWatchBoard } from "../steps/ExternalJobWatchBoard";
import { countRunningTools } from "../../lib/openclaw/task-orchestration";

function formatTimeMs(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return "—";
  return new Date(n).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      <div className="text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere] [word-break:break-word]">{children}</div>
    </div>
  );
}

const EMPTY_MESSAGES: LocalMessageRow[] = [];

const SIDE_BTN =
  "yt-btn-svc text-[11px] hover:border-[var(--brand-color)] hover:bg-[var(--brand-surface-select)] hover:text-[var(--brand-color)]";

const SIDE_BTN_PRIMARY =
  "yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90";

export const TaskRightPanel = memo(function TaskRightPanel() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const messages = useSessionStore((s) =>
    activeId ? (s.messagesBySession[activeId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES,
  );
  const loadMessages = useSessionStore((s) => s.loadMessages);
  const clearSessionMessages = useSessionStore((s) => s.clearSessionMessages);
  const summarizeAndContinueInNewChat = useSessionStore((s) => s.summarizeAndContinueInNewChat);
  const showToast = useUiStore((s) => s.showToast);
  const { connState, isSending, hasRemoteSession, copyDiagnostics, compactActiveSession } =
    useConnectionDiagnostics();
  const [clearOpen, setClearOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const workspacePathRef = useRef<string | null>(null);

  const steps = useStepStore((s) => s.steps);
  const activeSendId = useStepStore((s) => s.activeSendId);
  const replaceSteps = useStepStore((s) => s.replaceSteps);
  const visibleSteps = useMemo(
    () => (activeSendId ? steps.filter((st) => !st.sendId || st.sendId === activeSendId) : steps),
    [steps, activeSendId],
  );
  const hasRunning = useMemo(() => visibleSteps.some((st) => st.status === "running"), [visibleSteps]);
  const hasFailed = visibleSteps.some((st) => st.status === "failed");
  const runningToolCount = useMemo(() => countRunningTools(visibleSteps), [visibleSteps]);
  const planStepCount = useMemo(
    () => visibleSteps.filter((s) => s.kind === "plan").length,
    [visibleSteps],
  );

  const active = activeId ? sessions.find((x) => x.id === activeId) ?? null : null;
  const deliverySummary = useSyncExternalStore(
    subscribeTaskDelivery,
    () => getTaskDeliverySummary(activeId),
    () => null,
  );
  const loadLatestForSession = useTaskStore((s) => s.loadLatestForSession);
  const [rerunning, setRerunning] = useState(false);
  const [replayingSteps, setReplayingSteps] = useState(false);
  const [dismissedDeliveryKey, setDismissedDeliveryKey] = useState<string | null>(null);

  const deliveryKey =
    deliverySummary && activeId
      ? `${activeId}:${deliverySummary.at}`
      : null;
  const deliveryCardVisible =
    deliverySummary &&
    deliverySummary.outcome !== "empty" &&
    deliveryKey &&
    deliveryKey !== dismissedDeliveryKey;

  useEffect(() => {
    setDismissedDeliveryKey(null);
  }, [activeId]);

  const openOutputFolder = useCallback(async () => {
    try {
      const dir = await chatGetOutputDir();
      if (!dir?.trim()) {
        showToast("尚未设置产出目录", "info");
        return;
      }
      await revealPathInOs(dir);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [showToast]);

  const onReplaySteps = useCallback(async () => {
    if (!activeId) return;
    setReplayingSteps(true);
    try {
      const replayed = await loadReplayStepsForSession(activeId, activeSendId ?? undefined);
      if (replayed.length === 0) {
        showToast("未找到可恢复的历史步骤", "info");
        return;
      }
      replaceSteps(replayed);
      showToast(`已从历史恢复 ${replayed.length} 条步骤`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setReplayingSteps(false);
    }
  }, [activeId, activeSendId, replaceSteps, showToast]);

  const approxChars = useMemo(
    () => messages.reduce((acc, m) => acc + m.content.length, 0),
    [messages],
  );
  const approxTokens = Math.ceil(approxChars / 2);

  const agents = useAgentStore((s) => s.agents);
  const activeAgent = active?.agentId ? agents.find((a) => a.id === active.agentId) ?? null : null;

  const onCompact = useCallback(async () => {
    setCompacting(true);
    try {
      await compactActiveSession();
    } finally {
      setCompacting(false);
    }
  }, [compactActiveSession]);

  const openWorkspaceFolder = useCallback(async () => {
    if (!isTauriRuntime()) {
      showToast("此操作需在桌面版中使用。", "info");
      return;
    }
    const p = await openClawWorkspacePath();
    if (!p?.trim()) {
      showToast(`未获取到工作区路径，请确认本机服务已由 ${PRODUCT_NAME} 启动。`, "info");
      return;
    }
    workspacePathRef.current = p;
    try {
      await revealPathInOs(p);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [showToast]);

  const onConfirmClear = useCallback(async () => {
    if (!activeId) return;
    try {
      await clearSessionMessages(activeId);
      setClearOpen(false);
      showToast("已清空本机会话消息。", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [activeId, clearSessionMessages, showToast]);

  const exportJson = useCallback(async () => {
    if (!active) return;
    if (messages.length === 0) {
      showToast("当前会话无消息可导出。", "info");
      return;
    }
    const payload = {
      session: { id: active.id, title: active.title, createdAt: active.createdAt, updatedAt: active.updatedAt },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制为 JSON 到剪贴板。", "success");
    } catch {
      showToast("复制失败，请检查剪贴板权限。", "error");
    }
  }, [active, messages, showToast]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-[13px]">
      {!active && (
        <div className="yt-empty-state flex-1 px-4">
          <div className="mb-3 text-[var(--text-muted)]" aria-hidden>
            <svg className="mx-auto h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[var(--text-primary)]">新对话</p>
          <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-[var(--text-tertiary)]">
            发送首条消息后将创建会话；也可在左侧选择历史会话查看任务进度
          </p>
        </div>
      )}

      {active && (
        <>
          <details className="shrink-0 border-b border-[var(--separator)]/40 px-4 py-2">
            <summary className="cursor-pointer select-none py-1 text-xs font-medium text-[var(--text-secondary)]">
              会话信息
              <span className="ml-2 font-normal text-[var(--text-tertiary)]">
                {active.title} · ~{approxTokens} tokens
              </span>
            </summary>
            <div className="mt-2 flex flex-col gap-3 pb-3">
              <InfoRow label="名称">{active.title}</InfoRow>
              {activeAgent && (
                <InfoRow label="Agent">
                  <span className="inline-flex items-center gap-1.5">
                    <AgentAvatar agentId={activeAgent.id} agentName={activeAgent.name} size={18} />
                    <span className="text-[11px] font-medium text-[var(--brand-color)]">{activeAgent.name}</span>
                  </span>
                </InfoRow>
              )}
              <InfoRow label="创建">{formatTimeMs(active.createdAt)}</InfoRow>
              <InfoRow label="约 Token">~{approxTokens}</InfoRow>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => void exportJson()} className={SIDE_BTN}>
                  导出
                </button>
                <button type="button" onClick={() => setClearOpen(true)} className={SIDE_BTN}>
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeId) return;
                    void loadMessages(activeId);
                  }}
                  className={SIDE_BTN}
                >
                  重载
                </button>
              </div>
            </div>
          </details>

          {hasRemoteSession && connState === "connected" && (
            <div className="flex shrink-0 flex-wrap gap-2 border-b border-[var(--separator)]/40 px-4 py-2.5">
              <button
                type="button"
                className={SIDE_BTN}
                disabled={compacting || isSending}
                onClick={() => void onCompact()}
              >
                {compacting ? "压缩中…" : "压缩上下文"}
              </button>
              <button
                type="button"
                className={SIDE_BTN}
                disabled={handoffBusy || isSending}
                onClick={() => {
                  setHandoffBusy(true);
                  void summarizeAndContinueInNewChat().finally(() => setHandoffBusy(false));
                }}
              >
                {handoffBusy ? "处理中…" : "摘要并新建"}
              </button>
              <button type="button" onClick={() => void copyDiagnostics()} className={SIDE_BTN}>
                复制连接诊断
              </button>
              <button
                type="button"
                className={SIDE_BTN}
                disabled={replayingSteps || isSending}
                onClick={() => void onReplaySteps()}
              >
                {replayingSteps ? "恢复中…" : "从历史恢复步骤"}
              </button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-2">
            {(hasRunning || hasFailed) && (
              <div className="mb-2 shrink-0 space-y-0.5">
                {hasRunning && (
                  <p className="text-xs font-medium text-[var(--text-primary)]">
                    正在执行
                    {runningToolCount > 1 ? `（${runningToolCount} 个工具并行）` : ""}
                    {planStepCount > 0 ? ` · 计划 ${planStepCount} 步` : ""}
                  </p>
                )}
                {hasFailed && (
                  <p className="text-xs text-[var(--color-error)]">部分步骤失败，请展开查看详情</p>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-1 space-y-3">
              <ParallelSubtaskBoard sessionId={activeId} />
              <ExternalJobWatchBoard sessionId={activeId} />
              <TaskStepPipeline />
            </div>
          </div>

          {deliveryCardVisible && (
            <div
              className={[
                "mx-4 mb-2 shrink-0 rounded-[var(--radius-md)] border p-3 text-xs",
                deliverySummary.outcome === "failed"
                  ? "border-[color-mix(in_oklab,var(--color-error)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-error)_8%,var(--bg-elevated))]"
                  : deliverySummary.outcome === "partial" || deliverySummary.outcome === "cancelled"
                    ? "border-[color-mix(in_oklab,var(--color-warn)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_8%,var(--bg-elevated))]"
                    : "border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--color-success)_8%,var(--bg-elevated))]",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-[var(--text-primary)]">{deliverySummary.headline}</p>
                <button
                  type="button"
                  className="yt-transition shrink-0 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  onClick={() => setDismissedDeliveryKey(deliveryKey)}
                >
                  收起
                </button>
              </div>
              {deliverySummary.detail.trim() && (
                <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {deliverySummary.detail}
                </pre>
              )}
              {(deliverySummary.outcome === "completed" ||
                deliverySummary.outcome === "partial" ||
                deliverySummary.artifactCount > 0) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => void openOutputFolder()} className={SIDE_BTN_PRIMARY}>
                    打开产出文件夹
                  </button>
                  <button type="button" onClick={() => void openWorkspaceFolder()} className={SIDE_BTN}>
                    打开工作区
                  </button>
                </div>
              )}
              {(deliverySummary.outcome === "failed" ||
                deliverySummary.outcome === "partial" ||
                deliverySummary.outcome === "cancelled") &&
                activeId && (
                  <button
                    type="button"
                    className={`${SIDE_BTN} mt-2`}
                    disabled={rerunning || isSending}
                    onClick={() => {
                      setRerunning(true);
                      void loadLatestForSession(activeId)
                        .then(async (row) => {
                          if (!row) {
                            showToast("未找到可重跑的任务记录", "info");
                            return;
                          }
                          await rerunTask(row);
                        })
                        .finally(() => setRerunning(false));
                    }}
                  >
                    {rerunning ? "重跑中…" : "重跑本任务"}
                  </button>
                )}
              {deliverySummary.acceptance && deliverySummary.acceptance.length > 0 && (
                <div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
                  <p className="text-[11px] font-semibold text-[var(--text-primary)]">
                    验收 · {deliverySummary.acceptanceHeadline ?? "待确认"}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {deliverySummary.acceptance.map((item) => (
                      <li key={item.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                        <span
                          className={
                            item.passed
                              ? "text-[var(--color-success)]"
                              : "text-[var(--color-warn)]"
                          }
                          aria-hidden
                        >
                          {item.passed ? "✓" : "○"}
                        </span>
                        <span className="text-[var(--text-secondary)]">
                          {item.label}
                          {item.detail ? (
                            <span className="text-[var(--text-muted)]"> · {item.detail}</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

        </>
      )}

      <ConfirmDialog
        open={clearOpen}
        title="清空本机聊天记录？"
        titleId="yuntu-clear-title"
        variant="danger"
        confirmLabel="清空"
        onClose={() => setClearOpen(false)}
        onConfirm={async () => {
          await onConfirmClear();
        }}
      >
        将删除当前会话在本地库中的全部消息记录，此操作不可恢复。会话项本身会保留。
      </ConfirmDialog>
    </div>
  );
});
