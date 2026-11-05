import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { humanizeGatewayConn, humanizeGatewayConnShort } from "../../lib/ui/gateway-ui";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { qualityDotClass, qualityLabel, connStatusDotClass } from "../../lib/connection-quality";
import { performAppLogout } from "../../lib/app-logout";
import { requestDesktopConnect } from "../../lib/openclaw/desktop-connect-scheduler";
import { getLaunchConnectProfile } from "../../lib/openclaw/launch-connect-profile";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useAuthStore } from "../../stores/authStore";
import { useOwnerStore } from "../../stores/ownerStore";
import { useUiStore } from "../../stores/uiStore";
import { HeaderAgentSwitcher } from "./HeaderAgentSwitcher";
import { HeaderNavSlideRail } from "./HeaderNavSlideRail";
import type { NavKey } from "../../types/app-nav";
import type { SessionSubView } from "../../types/session-view";
import { gsap, useGSAP } from "../../lib/gsap/setup";
import { prefersReducedMotion } from "../../lib/gsap/setup";

const subTabs: { id: SessionSubView | "agents" | "skillStudio"; label: string; ownerOnly?: boolean }[] = [
  { id: "chat", label: "对话" },
  { id: "skillStudio", label: "技能工坊" },
  { id: "tools", label: "工具" },
  { id: "agents", label: "Agent" },
];

type Props = {
  nav: NavKey;
  onNav: (k: NavKey) => void;
  sessionSubView: SessionSubView;
  onSessionSubView: (v: SessionSubView) => void;
};

type TabIndicator = { x: number; y: number; w: number; h: number };

const INDICATOR_INIT: TabIndicator = { x: 0, y: 0, w: 0, h: 0 };

function IconUser({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconLogout({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export const AppHeaderBar = memo(function AppHeaderBar({ nav, onNav, sessionSubView, onSessionSubView }: Props) {
  const {
    connState,
    reconnectAttempt,
    reconnectDueAt,
    lastError,
    startupPhase,
    healthLatencyMs,
    connectionQuality,
  } = useGatewayStore(
    useShallow((s) => ({
      connState: s.connState as GatewayConnStateWord,
      reconnectAttempt: s.reconnectAttempt,
      reconnectDueAt: s.reconnectDueAt,
      lastError: s.lastError,
      startupPhase: s.startupPhase,
      healthLatencyMs: s.healthLatencyMs,
      connectionQuality: s.connectionQuality,
    })),
  );
  const cancelReconnect = useGatewayStore((s) => s.cancelReconnect);
  const user = useAuthStore((s) => s.user);
  const ownerUnlocked = useOwnerStore((s) => s.unlocked);
  const ownerLogout = useOwnerStore((s) => s.logout);
  const requestNavToSettings = useUiStore((s) => s.requestNavToSettings);
  const headerNavMode = useUiStore((s) => s.headerNavMode);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const long = humanizeGatewayConn(connState);
  const short = humanizeGatewayConnShort(connState);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<TabIndicator>(INDICATOR_INIT);

  const activeTabId = nav === "sessions" ? sessionSubView : nav;
  const visibleSubTabs = subTabs.filter((t) => !t.ownerOnly || ownerUnlocked);
  const showSubTabNav =
    nav === "sessions" || nav === "agents" || nav === "skillStudio";
  const showPillStrip = showSubTabNav && headerNavMode === "expanded";

  const navigateSubTab = useCallback(
    (id: (typeof subTabs)[number]["id"]) => {
      if (id === "agents") {
        onNav("agents");
      } else if (id === "skillStudio") {
        onNav("skillStudio");
      } else {
        const subView = id as SessionSubView;
        onSessionSubView(subView);
        if (nav !== "sessions") {
          onNav("sessions");
        }
      }
    },
    [nav, onNav, onSessionSubView],
  );

  const updateTabIndicator = useCallback(() => {
    const strip = tabStripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLButtonElement>(`[data-subtab-id="${activeTabId}"]`);
    if (!active) return;
    const s = strip.getBoundingClientRect();
    const b = active.getBoundingClientRect();
    const next = {
      x: b.left - s.left,
      y: b.top - s.top,
      w: b.width,
      h: b.height,
    };
    setIndicator((prev) => {
      if (
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5 &&
        Math.abs(prev.w - next.w) < 0.5 &&
        Math.abs(prev.h - next.h) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, [activeTabId]);

  useLayoutEffect(() => {
    if (!showPillStrip || !showSubTabNav) return;
    updateTabIndicator();
    const strip = tabStripRef.current;
    if (!strip) return;
    let raf = 0;
    const schedule = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateTabIndicator();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(strip);
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [nav, activeTabId, updateTabIndicator, showPillStrip, showSubTabNav]);

  const connected = connState === "connected";
  const statusHint =
    (startupPhase?.trim() ? sanitizeUserFacingCopy(startupPhase) : null) ||
    (lastError?.trim() && connState !== "connecting" && lastError.length <= 120
      ? sanitizeUserFacingCopy(lastError)
      : null) ||
    (reconnectDueAt != null && !connected
      ? `${long} · ${Math.max(0, Math.ceil((reconnectDueAt - Date.now()) / 1000))}s 后自动重连`
      : reconnectAttempt > 0 && !connected
        ? `${long} · 重连 ${reconnectAttempt}`
        : connected && healthLatencyMs != null
          ? `${long} · ${qualityLabel(connectionQuality)}（${healthLatencyMs}ms）`
          : long);
  const connActionHint =
    connState === "error" || connState === "disconnected"
      ? " · 点击重连"
      : "";
  const connDotClass = connStatusDotClass(connState, connected);
  const connBtnRef = useRef<HTMLButtonElement>(null);

  useGSAP(
    () => {
      if (!connected || prefersReducedMotion()) return;
      const dot = connBtnRef.current?.querySelector<HTMLElement>(".app-header-agent-chip__dot");
      if (!dot) return;
      gsap.fromTo(
        dot,
        { scale: 1 },
        {
          scale: 1.35,
          duration: 0.6,
          ease: "power2.inOut",
          yoyo: true,
          repeat: -1,
        },
      );
    },
    { scope: connBtnRef, dependencies: [connected] },
  );

  return (
    <header
      className={[
        "app-header-bar flex shrink-0 items-stretch justify-between gap-3",
        headerNavMode === "collapsed"
          ? "app-header-bar--collapsed"
          : headerNavMode === "expanded"
            ? "app-header-bar--expanded"
            : "app-header-bar--normal",
      ].join(" ")}
    >
      <div className="flex min-w-0 flex-1 items-center pl-4">
        {showSubTabNav && (
          <nav className="flex h-full min-w-0 items-center" aria-label="工作区">
            {showPillStrip ? (
            <div
              ref={tabStripRef}
              className="app-header-pill-strip app-header-pill-strip--workspace relative flex max-w-full items-stretch"
              role="tablist"
              aria-label="工作区子视图"
            >
              <div
                className="app-header-pill__glide pointer-events-none absolute left-0 top-0"
                style={{
                  width: Math.max(0, indicator.w),
                  height: Math.max(0, indicator.h),
                  transform: `translate(${indicator.x}px, ${indicator.y}px)`,
                  opacity: indicator.w > 0 ? 1 : 0,
                }}
                aria-hidden
              />
              {visibleSubTabs.map((t) => {
                const on = activeTabId === t.id;
                return (
                  <button
                    key={t.id}
                    data-subtab-id={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => navigateSubTab(t.id)}
                    className={[
                      "app-header-pill__tab relative z-10",
                      on ? "app-header-pill__tab--active" : "",
                    ].join(" ")}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            ) : (
              <HeaderNavSlideRail
                tabs={visibleSubTabs}
                activeTabId={activeTabId}
                onSelect={(id) => navigateSubTab(id as (typeof subTabs)[number]["id"])}
              />
            )}
          </nav>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 pr-4">
        <HeaderAgentSwitcher />
        {connected && connectionQuality !== "unknown" && (
          <div
            className="app-header-agent-chip"
            role="status"
            aria-label={`本机服务延迟约 ${healthLatencyMs ?? "未知"} 毫秒，${qualityLabel(connectionQuality)}`}
            title={`本机服务延迟约 ${healthLatencyMs ?? "—"} ms · ${qualityLabel(connectionQuality)}`}
          >
            <span
              className={["app-header-agent-chip__dot", qualityDotClass(connectionQuality)].join(" ")}
              aria-hidden
            />
            <span className="tabular-nums">{healthLatencyMs != null ? `${healthLatencyMs}ms` : "—"}</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            if (reconnectDueAt != null && !connected) {
              cancelReconnect();
            }
            if (connState === "error" || connState === "disconnected" || connState === "connecting") {
              const profile = getLaunchConnectProfile();
              void requestDesktopConnect({
                context: "重连",
                direct: true,
                fastReopen: connState !== "error",
                maxMs: profile.startupConnectMaxMs,
              });
            }
          }}
          ref={connBtnRef}
          aria-label={`本机服务：${statusHint}${connActionHint}`}
          className={[
            "app-header-agent-chip max-w-[11rem]",
            connected ? "app-header-agent-chip--connected" : "",
          ].join(" ")}
          title={`${statusHint}${connActionHint}`}
        >
          <span className={["app-header-agent-chip__dot shrink-0", connDotClass].join(" ")} aria-hidden />
          <span className="truncate">本机 · {short}</span>
          {(connState === "error" || connState === "disconnected") && (
            <span className="shrink-0 text-[10px] font-medium text-[var(--brand-color)]">重连</span>
          )}
          {connState === "connecting" && (
            <span className="shrink-0 text-[10px] font-medium text-[var(--brand-color)]">重试</span>
          )}
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowUserMenu((v) => !v)}
            aria-expanded={showUserMenu}
            aria-haspopup="menu"
            aria-label={`用户菜单：${user?.username ?? ""}`}
            className="app-header-agent-chip app-header-agent-chip--avatar p-0.5"
            title={`当前用户: ${user?.username ?? ""}`}
          >
            <span className="app-header-user-avatar" aria-hidden>
              {(user?.username?.[0] ?? "U").toUpperCase()}
            </span>
          </button>
          {showUserMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                role="presentation"
                onClick={() => setShowUserMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-xl py-1 yt-menu-dropdown">
                {ownerUnlocked ? (
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-400/10 transition-colors"
                    onClick={() => {
                      setShowUserMenu(false);
                      void ownerLogout();
                    }}
                  >
                    锁定 Owner
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                    onClick={() => {
                      setShowUserMenu(false);
                      requestNavToSettings("owner-unlock");
                    }}
                  >
                    Owner 解锁
                  </button>
                )}
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                  onClick={() => {
                    setShowUserMenu(false);
                    onNav("settings");
                  }}
                >
                  <IconUser className="h-4 w-4" />
                  软件设置
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-400/10 transition-colors"
                  onClick={() => {
                    setShowUserMenu(false);
                    void performAppLogout();
                  }}
                >
                  <IconLogout className="h-4 w-4" />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
});
