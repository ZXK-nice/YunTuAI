import { useEffect } from "react";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { humanizeGatewayConn } from "../../lib/ui/gateway-ui";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useTaskStore, type LocalTaskRow } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";
import { GatewayServiceControls } from "../openclaw/GatewayServiceControls";
import { rerunTask } from "../../lib/openclaw/task-rerun";

function IconActivity({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function IconServer({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

function IconWifi({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" />
    </svg>
  );
}

function statusDotClass(state: GatewayConnStateWord): string {
  switch (state) {
    case "connected":
      return "dashboard-status-dot--connected";
    case "connecting":
      return "dashboard-status-dot--connecting";
    case "error":
      return "dashboard-status-dot--error";
    default:
      return "dashboard-status-dot--disconnected";
  }
}

function taskStatusLabel(status: string): string {
  switch (status) {
    case "running":
      return "执行中";
    case "completed":
      return "已完成";
    case "partial":
      return "部分完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function formatTaskTime(ms: string): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  return new Date(n).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function openTaskSession(task: LocalTaskRow) {
  const sid = task.sessionId?.trim();
  if (!sid) {
    useUiStore.getState().showToast("该任务未关联会话", "info");
    return;
  }
  useSessionStore.getState().selectSession(sid);
  useUiStore.getState().requestNavToChat(sid);
  useUiStore.getState().requestOpenSidePanel();
}

function canRerun(task: LocalTaskRow): boolean {
  return task.status === "failed" || task.status === "partial" || task.status === "cancelled";
}

export function DashboardPanel() {
  const connState = useGatewayStore((s) => s.connState) as GatewayConnStateWord;
  const lastError = useGatewayStore((s) => s.lastError);
  const exclusiveReport = useGatewayStore((s) => s.exclusiveReport);
  const recentTasks = useTaskStore((s) => s.recent);
  const tasksLoading = useTaskStore((s) => s.loading);
  const loadRecent = useTaskStore((s) => s.loadRecent);

  const isRunning = exclusiveReport?.supervisor.running ?? false;
  const supervisorPid = exclusiveReport?.supervisor.pid;
  const bundledReady = exclusiveReport?.bundledReady ?? false;
  const hasConflict = exclusiveReport?.externalGatewayConflict ?? false;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void loadRecent(12);
  }, [loadRecent, connState]);

  return (
    <div className="space-y-5 text-[var(--text-secondary)]">
      <p className="text-sm leading-relaxed">
        本机服务由 {PRODUCT_NAME} 独占监管；监管状态由后台事件推送更新。
      </p>

      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]">
            <IconWifi className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={statusDotClass(connState)} />
              <div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {connState === "connected"
                    ? "服务已连接"
                    : connState === "connecting"
                      ? "正在连接…"
                      : connState === "error"
                        ? "连接异常"
                        : "服务未连接"}
                </span>
                {connState === "connected" && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_12%,var(--bg-elevated))] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                    正常
                  </span>
                )}
              </div>
            </div>
            {lastError && (
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-error)]">
                {sanitizeUserFacingCopy(lastError)}
              </p>
            )}
            {connState !== "connected" && (
              <button
                type="button"
                disabled={connState === "connecting"}
                className="yt-press mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-color)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--brand-color-emphasis)] disabled:opacity-50"
                onClick={() => void connectWithFeedback("重连")}
              >
                {connState === "connecting" ? "连接中…" : "重新连接"}
              </button>
            )}
          </div>
        </div>
      </div>

      {isTauriRuntime() && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-success)_12%,var(--bg-elevated))] text-[var(--color-success)]">
              <IconServer className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={isRunning ? "dashboard-status-dot--connected" : "dashboard-status-dot--disconnected"} />
                <span className="text-sm font-semibold text-[var(--text-primary)]">本机服务进程</span>
                {isRunning ? (
                  <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--color-success)_12%,var(--bg-elevated))] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">
                    运行中
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-[color-mix(in_oklab,var(--text-muted)_15%,var(--bg-elevated))] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
                    未运行
                  </span>
                )}
              </div>

              {exclusiveReport && (
                <div className="mt-3 dashboard-metric-grid">
                  <div className="dashboard-metric-box">
                    <div className="dashboard-metric-value">{isRunning ? "活跃" : "停止"}</div>
                    <div className="dashboard-metric-label">状态</div>
                  </div>
                  <div className="dashboard-metric-box">
                    <div className="dashboard-metric-value">{supervisorPid != null ? supervisorPid : "—"}</div>
                    <div className="dashboard-metric-label">PID</div>
                  </div>
                  <div className="dashboard-metric-box">
                    <div className="dashboard-metric-value">{bundledReady ? "就绪" : "未就绪"}</div>
                    <div className="dashboard-metric-label">运行时</div>
                  </div>
                </div>
              )}

              {hasConflict && (
                <p className="mt-3 text-xs font-medium text-[var(--color-error)]">
                  检测到外部本机服务进程冲突，请执行「回收控制权」
                </p>
              )}

              {exclusiveReport &&
                exclusiveReport.warnings.filter(
                  (w) =>
                    !w.startsWith(`本机服务由 ${PRODUCT_NAME}`) &&
                    !w.startsWith(`网关由 ${PRODUCT_NAME}`),
                ).length > 0 && (
                  <div className="mt-3 space-y-1">
                    {exclusiveReport.warnings
                      .filter(
                        (w) =>
                          !w.startsWith(`本机服务由 ${PRODUCT_NAME}`) &&
                          !w.startsWith(`网关由 ${PRODUCT_NAME}`),
                      )
                      .slice(0, 2)
                      .map((w) => (
                        <p key={w} className="text-[11px] leading-relaxed text-[var(--color-warn)]">
                          {w}
                        </p>
                      ))}
                  </div>
                )}

              <GatewayServiceControls showCliOutput className="mt-4" />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <IconActivity className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">近期办事</p>
            <p className="text-[11px] text-[var(--text-muted)]">
              {connState === "connected"
                ? `系统运行正常 · ${humanizeGatewayConn(connState)}`
                : humanizeGatewayConn(connState)}
            </p>
          </div>
          <button
            type="button"
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
            onClick={() => void loadRecent(12)}
            disabled={tasksLoading}
          >
            {tasksLoading ? "刷新中…" : "刷新"}
          </button>
        </div>

        {recentTasks.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">
            暂无任务记录。在对话中发送消息或使用快捷模板后，完成情况会出现在这里。
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {recentTasks.slice(0, 12).map((t) => (
              <li key={t.id}>
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    onClick={() => openTaskSession(t)}
                    className="yt-transition flex min-w-0 flex-1 items-start gap-2 rounded-[var(--radius-md)] border border-transparent px-2.5 py-2 text-left hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                  >
                    <span
                      className={[
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px]",
                        t.status === "failed"
                          ? "bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)] text-[var(--color-error)]"
                          : t.status === "running"
                            ? "bg-[color-mix(in_oklab,var(--brand-color)_12%,transparent)] text-[var(--brand-color)]"
                            : t.status === "partial"
                              ? "bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]"
                              : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]",
                      ].join(" ")}
                    >
                      {taskStatusLabel(t.status)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-[var(--text-primary)]">{t.title}</span>
                      <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">
                        {formatTaskTime(t.updatedAt)}
                        {t.sessionId ? " · 打开会话与侧栏" : ""}
                      </span>
                    </span>
                  </button>
                  {canRerun(t) && (
                    <button
                      type="button"
                      className="yt-transition shrink-0 self-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)]"
                      onClick={() => void rerunTask(t).then((ok) => { if (ok) void loadRecent(12); })}
                      title="用原任务内容重新发送"
                    >
                      重跑
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
