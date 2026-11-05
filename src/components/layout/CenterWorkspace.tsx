import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import type { NavKey } from "../../types/app-nav";
import type { SessionSubView } from "../../types/session-view";
import { fetchDistributionProfile } from "../../lib/openclaw/env-bridge";
import { INTERNAL_PROFILE_ID } from "../../lib/distribution-profile";
import { TokenPortalButtons } from "../chat/TokenPortalButtons";
import { AppErrorBoundary } from "../ui/AppErrorBoundary";
import { OwnerGate } from "../owner/OwnerGate";
const TaskRightPanel = lazy(() =>
  import("./TaskRightPanel").then((m) => ({ default: m.TaskRightPanel })),
);
import { ToastHost } from "../ui/ToastHost";

const OpenClawConsolePanel = lazy(() =>
  import("../console/OpenClawConsolePanel").then((m) => ({ default: m.OpenClawConsolePanel })),
);
const DashboardPanel = lazy(() =>
  import("../dashboard/DashboardPanel").then((m) => ({ default: m.DashboardPanel })),
);
const AgentDashboard = lazy(() =>
  import("../dashboard/AgentDashboard").then((m) => ({ default: m.AgentDashboard })),
);
const GatewayLogsPanel = lazy(() =>
  import("../logs/GatewayLogsPanel").then((m) => ({ default: m.GatewayLogsPanel })),
);
const GatewaySettings = lazy(() =>
  import("../settings/GatewaySettings").then((m) => ({ default: m.GatewaySettings })),
);
const SkillStudioPanel = lazy(() =>
  import("../skills/SkillStudioPanel").then((m) => ({ default: m.SkillStudioPanel })),
);
const ImageStudioPanel = lazy(() =>
  import("../imageStudio/ImageStudioPanel").then((m) => ({ default: m.ImageStudioPanel })),
);
const ToolsPanel = lazy(() =>
  import("../workspace/ToolsPanel").then((m) => ({ default: m.ToolsPanel })),
);
const ChatPanel = lazy(() =>
  import("../chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

function PanelFallback() {
  return (
    <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--text-tertiary)]">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--brand-color)]" />
      加载中…
    </div>
  );
}


type Props = {
  nav: NavKey;
  sessionSubView: SessionSubView;
  stepsOpen: boolean;
  stepsWidth: number;
  onToggleSteps: () => void;
  onResizeSteps: (clientX: number, startX: number, startW: number) => void;
  onNav: (k: NavKey) => void;
};

function IconMessage({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconLayout({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconPanelClose({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function IconSettings({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function IconList({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconTerm({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M6 9 9 12l-3 3M10 16h4" />
    </svg>
  );
}


const pageMeta: Record<NavKey, { label: string; sub: string; icon: (props: { className?: string }) => ReactNode }> = {
  sessions: { label: "对话", sub: "", icon: (p) => <IconMessage {...p} /> },
  agents: { label: "Agent 指挥中心", sub: "多 Agent 调度与状态总览", icon: (p) => <IconLayout {...p} /> },
  skillStudio: { label: "技能工坊", sub: "按行业岗位定制办事技能", icon: (p) => <IconList {...p} /> },
  imageStudio: { label: "作图", sub: "Seedream 文生图与历史管理", icon: (p) => <IconLayout {...p} /> },
  meetingAssistant: { label: "对话", sub: "", icon: (p) => <IconMessage {...p} /> },
  dashboard: { label: "仪表盘", sub: "概览与状态一览", icon: (p) => <IconLayout {...p} /> },
  settings: { label: "软件设置", sub: "通用、账号、模型密钥与本机服务", icon: (p) => <IconSettings {...p} /> },
  logs: { label: "日志", sub: "服务与审计记录", icon: (p) => <IconList {...p} /> },
  advanced: { label: "高级控制台", sub: "本机服务全能力管理", icon: (p) => <IconTerm {...p} /> },
};

export function CenterWorkspace({
  nav,
  sessionSubView,
  stepsOpen,
  stepsWidth,
  onToggleSteps,
  onResizeSteps,
  onNav,
}: Props) {
  const [profileId, setProfileId] = useState<string | null>(null);
  const meta = pageMeta[nav];
  const showPageHeader = nav !== "sessions";
  const isChatImmersive = nav === "sessions" && sessionSubView === "chat";

  useEffect(() => {
    void fetchDistributionProfile().then((p) => setProfileId(p?.profile ?? INTERNAL_PROFILE_ID));
  }, []);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 items-stretch overflow-hidden">
      <div
        className={[
          "relative z-[2] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isChatImmersive
            ? "chat-immersive-shell m-0 rounded-none border-0"
            : "m-3 rounded-[var(--radius-lg)] border border-[var(--separator)] bg-[var(--bg-elevated)]",
        ].join(" ")}
      >
        {showPageHeader && (
          <div className="select-none flex shrink-0 items-center justify-between gap-4 border-b border-[var(--separator)]/40 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]">
                {meta.icon({ className: "h-4 w-4" })}
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold leading-tight text-[var(--text-primary)]">{meta.label}</div>
                {meta.sub && <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{meta.sub}</div>}
              </div>
            </div>
            {nav === "agents" && (
              <TokenPortalButtons profileId={profileId} />
            )}
          </div>
        )}

        <div
          key={`panel-${nav}-${sessionSubView}`}
          className={[
            "yt-panel-fade-in min-h-0 flex-1 text-sm text-[var(--text-secondary)]",
            nav === "sessions" ? "flex min-h-0 flex-col overflow-hidden" : "overflow-auto p-4",
            nav === "sessions" && sessionSubView === "chat" ? "p-0" : "",
            nav === "sessions" && sessionSubView !== "chat" ? "p-0" : "",
          ].join(" ")}
        >
          {nav === "sessions" && sessionSubView === "chat" && (
            <AppErrorBoundary title="对话区渲染失败">
              <Suspense fallback={<PanelFallback />}>
                <ChatPanel />
              </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "sessions" && sessionSubView === "tools" && (
            <AppErrorBoundary title="工具面板渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <ToolsPanel onNav={onNav} />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "settings" && (
            <AppErrorBoundary title="设置面板渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <GatewaySettings />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "agents" && (
            <AppErrorBoundary title="Agent 指挥中心渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <AgentDashboard />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "skillStudio" && (
            <AppErrorBoundary title="技能工坊渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <SkillStudioPanel />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "imageStudio" && (
            <AppErrorBoundary title="作图渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <ImageStudioPanel />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "dashboard" && (
            <AppErrorBoundary title="仪表盘渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <DashboardPanel />
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "logs" && (
            <AppErrorBoundary title="日志面板渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <OwnerGate title="运行日志" description="本机服务日志与操作审计记录需 Owner 解锁后查看。">
                <GatewayLogsPanel />
              </OwnerGate>
            </Suspense>
            </AppErrorBoundary>
          )}
          {nav === "advanced" && (
            <AppErrorBoundary title="高级控制台渲染失败">
            <Suspense fallback={<PanelFallback />}>
              <OwnerGate title="高级控制台" description="RPC 与开发工具需 Owner 解锁后使用。">
                <OpenClawConsolePanel />
              </OwnerGate>
            </Suspense>
            </AppErrorBoundary>
          )}
        </div>
        <ToastHost />
      </div>

      {stepsOpen && (
        <>
          <StepsResizer
            startWidth={stepsWidth}
            onResize={(clientX, startX, startW) => onResizeSteps(clientX, startX, startW)}
          />
          <div
            className={[
              "task-right-panel relative z-[3] flex min-h-0 min-w-0 shrink-0 flex-col self-stretch overflow-hidden",
              isChatImmersive ? "m-0 ml-0" : "m-3 ml-0",
            ].join(" ")}
            style={{ width: stepsWidth }}
          >
            <div
              className={[
                "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--separator)] bg-[var(--bg-elevated)]",
                isChatImmersive ? "rounded-none border-l border-y-0 border-r-0 bg-[var(--bg-elevated)]/95 backdrop-blur-md" : "",
              ].join(" ")}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--separator)]/40 px-3 py-2">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">任务进度</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onNav("settings")}
                    className="yt-press yt-icon-btn-32 text-[var(--text-tertiary)]"
                    title="设置"
                    aria-label="设置"
                  >
                    <IconSettings className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onToggleSteps}
                    className="yt-press yt-icon-btn-32 text-[var(--text-tertiary)]"
                    title="收起侧栏"
                    aria-label="收起任务进度侧栏"
                  >
                    <IconPanelClose className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <AppErrorBoundary title="任务进度侧栏渲染失败">
                  <Suspense fallback={<PanelFallback />}>
                    <TaskRightPanel />
                  </Suspense>
                </AppErrorBoundary>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function StepsResizer({
  startWidth,
  onResize,
}: {
  startWidth: number;
  onResize: (clientX: number, startX: number, startW: number) => void;
}) {
  // 保存进行中拖拽的清理函数：组件在拖拽途中卸载时也能移除 window 监听，避免泄漏。
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <div
      className="group relative w-2 shrink-0 cursor-col-resize"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        cleanupRef.current?.();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        const startX = e.clientX;
        const startW = startWidth;
        const move = (ev: PointerEvent) => onResize(ev.clientX, startX, startW);
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
          cleanupRef.current = null;
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch {
            /* pointer 可能已释放 */
          }
        };
        cleanupRef.current = stop;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
        window.addEventListener("pointercancel", stop, { once: true });
      }}
      title="拖拽调整右侧面板宽度"
    >
      <div className="absolute inset-y-8 left-1/2 w-px -translate-x-1/2 bg-[var(--border-subtle)] transition-colors duration-200 ease-out group-hover:bg-[color-mix(in_oklab,var(--brand-color)_40%,var(--border-subtle))]" />
    </div>
  );
}
