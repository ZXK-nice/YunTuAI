import { PRODUCT_NAME } from "../../lib/product-brand";
import { useUiStore } from "../../stores/uiStore";
import { useOwnerStore } from "../../stores/ownerStore";
import { useSessionStore } from "../../stores/sessionStore";
import type { NavKey } from "../../types/app-nav";
import { SessionSidebarPanel } from "./SessionSidebarPanel";

type Props = {
  active: NavKey;
  onNavigate: (k: NavKey) => void;
  logoSrc: string;
  version: string;
  taskPanelOpen: boolean;
  onToggleTaskPanel: () => void;
};

function IconHistory({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 12a9 9 0 1 0 9-9" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z" />
    </svg>
  );
}

function IconLayout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function IconGear({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
    </svg>
  );
}

function IconChats({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconPanelLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IconPanelRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
      <path d="M8 9l3 3-3 3" />
    </svg>
  );
}

function TaskPanelRailButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={["sidebar-rail-btn", open ? "sidebar-rail-btn--active" : ""].filter(Boolean).join(" ")}
      title={open ? "收起任务进度" : "任务进度"}
      aria-label={open ? "收起任务进度侧栏" : "打开任务进度侧栏"}
      aria-pressed={open}
    >
      <IconPanelRight className="h-4 w-4" />
    </button>
  );
}

function IconTerm({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M6 9 9 12l-3 3M10 16h4" />
    </svg>
  );
}

function SidebarBottomActions({
  onNavigate,
  ownerUnlocked,
}: {
  onNavigate: (k: NavKey) => void;
  ownerUnlocked: boolean;
}) {
  const colorScheme = useUiStore((s) => s.colorScheme);
  const toggleColorScheme = useUiStore((s) => s.toggleColorScheme);
  const requestNavToSettings = useUiStore((s) => s.requestNavToSettings);
  const showToast = useUiStore((s) => s.showToast);

  const goLogs = () => {
    if (!ownerUnlocked) {
      requestNavToSettings("owner-unlock");
      showToast("运行日志需 Owner 解锁", "info");
      return;
    }
    onNavigate("logs");
  };

  const goAdvanced = () => {
    if (!ownerUnlocked) {
      requestNavToSettings("owner-unlock");
      showToast("高级控制台需 Owner 解锁", "info");
      return;
    }
    onNavigate("advanced");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onNavigate("dashboard")}
        className="sidebar-rail-btn"
        title="仪表盘"
        aria-label="打开仪表盘"
      >
        <IconLayout className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onNavigate("settings")}
        className="sidebar-rail-btn"
        title="软件设置"
        aria-label="打开软件设置"
      >
        <IconGear className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={toggleColorScheme}
        className="sidebar-rail-btn"
        title={colorScheme === "light" ? "切换深色模式" : "切换浅色模式"}
        aria-label={colorScheme === "light" ? "切换深色模式" : "切换浅色模式"}
      >
        {colorScheme === "light" ? <IconMoon className="h-4 w-4" /> : <IconSun className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={goLogs}
        className="sidebar-rail-btn"
        title={ownerUnlocked ? "运行日志" : "运行日志需 Owner 解锁"}
        aria-label={ownerUnlocked ? "运行日志" : "运行日志需 Owner 解锁"}
      >
        <IconHistory className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={goAdvanced}
        className="sidebar-rail-btn"
        title={ownerUnlocked ? "高级控制台" : "高级控制台需 Owner 解锁"}
        aria-label={ownerUnlocked ? "高级控制台" : "高级控制台需 Owner 解锁"}
      >
        <IconTerm className="h-4 w-4" />
      </button>
    </>
  );
}

export function Sidebar({ onNavigate, logoSrc, version, taskPanelOpen, onToggleTaskPanel }: Props) {
  const sidebarExpanded = useUiStore((s) => s.sidebarExpanded);
  const setSidebarExpanded = useUiStore((s) => s.setSidebarExpanded);
  const ownerUnlocked = useOwnerStore((s) => s.unlocked);
  const sessionCount = useSessionStore((s) => s.sessions.length);

  const focusChat = () => onNavigate("sessions");

  const onNewChat = () => {
    useSessionStore.getState().enterComposeMode();
    focusChat();
  };

  return (
    <aside
      className={[
        "app-sidebar flex h-full min-h-0 shrink-0 flex-col overflow-hidden",
        sidebarExpanded ? "app-sidebar--expanded" : "app-sidebar--collapsed",
      ].join(" ")}
    >
      {sidebarExpanded ? (
        <>
          <div className="shrink-0 px-3 pb-2 pt-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onNavigate("sessions")}
                title="返回对话"
                className="yt-transition flex min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--brand-color)_30%,transparent)]"
              >
                <div className="app-brand-logo-slot app-brand-logo-slot--expanded">
                  <img src={logoSrc} alt="" className="app-brand-logo-img" width={52} height={52} />
                </div>
                <span className="min-w-0 text-sm font-semibold leading-tight tracking-tight text-[var(--text-primary)]">
                  {PRODUCT_NAME}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarExpanded(false)}
                className="sidebar-rail-btn shrink-0"
                title="收起会话栏"
                aria-label="收起会话栏"
                aria-expanded="true"
              >
                <IconPanelLeft className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <SessionSidebarPanel onFocusChat={focusChat} />
          </div>

          <div className="sidebar-bottom relative flex shrink-0 items-center gap-2 px-4 py-3">
            <div className="absolute inset-0 bg-[var(--bg-app)] opacity-80" />
            <div className="absolute inset-0 backdrop-blur-[12px] -webkit-backdrop-blur-[12px]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--separator)] to-transparent" />
            <div className="relative z-[1] flex w-full items-center gap-2">
              <TaskPanelRailButton open={taskPanelOpen} onToggle={onToggleTaskPanel} />
              <SidebarBottomActions onNavigate={onNavigate} ownerUnlocked={ownerUnlocked} />
              <span className="ml-auto text-[10px] tabular-nums text-[var(--text-muted)]">v{version}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 px-2 pt-0">
            <button
              type="button"
              onClick={() => onNavigate("sessions")}
              className="sidebar-rail-btn sidebar-rail-btn--logo"
              title={PRODUCT_NAME}
              aria-label="返回对话"
            >
              <span className="app-brand-logo-slot app-brand-logo-slot--rail">
                <img src={logoSrc} alt="" className="app-brand-logo-img" width={52} height={52} />
              </span>
            </button>
            <button
              type="button"
              onClick={onNewChat}
              className="sidebar-rail-btn sidebar-rail-btn--primary"
              title="新对话"
              aria-label="新对话"
            >
              <IconPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSidebarExpanded(true)}
              className="sidebar-rail-btn relative"
              title="展开会话列表"
              aria-label="展开会话列表"
              aria-expanded="false"
            >
              <IconChats className="h-4 w-4" />
              {sessionCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--text-primary)] px-1 text-[9px] font-semibold text-[var(--bg-elevated)]">
                  {sessionCount > 99 ? "99+" : sessionCount}
                </span>
              )}
            </button>
            <TaskPanelRailButton open={taskPanelOpen} onToggle={onToggleTaskPanel} />
          </div>

          <div className="mt-auto flex flex-col items-center gap-1.5 px-2 pb-3">
            <SidebarBottomActions onNavigate={onNavigate} ownerUnlocked={ownerUnlocked} />
            <span className="mt-1 text-[9px] tabular-nums text-[var(--text-muted)]">v{version}</span>
          </div>
        </>
      )}
    </aside>
  );
}
