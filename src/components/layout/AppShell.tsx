import { useCallback, useEffect, useRef, useState } from "react";
import { useAppLogo } from "../../hooks/useAppLogo";
import { useAppBootstrap } from "../../hooks/useAppBootstrap";
import { useUpgradeWelcomeNotice } from "../../hooks/useUpgradeWelcomeNotice";
import { useFirstReadyHint } from "../../hooks/useFirstReadyHint";
import { useExecApprovalBridge } from "../../hooks/useExecApprovalBridge";
import { useStartupToasts } from "../../hooks/useStartupToasts";
import { ExecApprovalDialog } from "../openclaw/ExecApprovalDialog";
import { AppErrorBoundary } from "../ui/AppErrorBoundary";
import { useAppKeyboardShortcuts } from "../../hooks/useAppKeyboardShortcuts";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useIdleTimeout } from "../../hooks/useIdleTimeout";
import { APP_VERSION } from "../../lib/app-version";
import { resolveAppNav, type NavKey } from "../../types/app-nav";
import type { SessionSubView } from "../../types/session-view";
import { setForceLogoutHandler } from "../../lib/force-logout-handler";
import { performAppLogout } from "../../lib/app-logout";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AppHeaderBar } from "./AppHeaderBar";
import { CenterWorkspace } from "./CenterWorkspace";
import { Sidebar } from "./Sidebar";
import { AppShellEntrance } from "../motion/AppShellEntrance";

export type { NavKey } from "../../types/app-nav";

export function AppShell() {
  useAppBootstrap();
  useUpgradeWelcomeNotice();
  useExecApprovalBridge();
  useFirstReadyHint();
  useStartupToasts();
  useIdleTimeout();
  const logoSrc = useAppLogo();
  const [forceLogoutReason, setForceLogoutReason] = useState<string | null>(null);
  const forceLogoutRef = useRef<string | null>(null);

  useEffect(() => {
    setForceLogoutHandler((reason: string) => {
      forceLogoutRef.current = reason;
      setForceLogoutReason(reason);
    });
    return () => setForceLogoutHandler(null);
  }, []);

  const handleForceLogoutConfirm = useCallback(() => {
    setForceLogoutReason(null);
    forceLogoutRef.current = null;
    void performAppLogout();
  }, []);

  const [nav, setNav] = useState<NavKey>("sessions");
  const [sessionSubView, setSessionSubView] = useState<SessionSubView>("chat");
  const [stepsOpen, setStepsOpen] = useState(false);
  const [stepsWidth, setStepsWidth] = useState(280);

  const onResizeSteps = useCallback(
    (clientX: number, startX: number, startW: number) => {
      const delta = startX - clientX;
      const next = Math.min(520, Math.max(240, startW + delta));
      setStepsWidth(next);
    },
    [],
  );

  const goNav = useCallback(
    (k: NavKey) => {
      const next = resolveAppNav(k);
      setNav(next);
      if (next === "sessions") setSessionSubView("chat");
    },
    [],
  );

  const navIntent = useUiStore((s) => s.navIntent);
  const sidePanelOpenTick = useUiStore((s) => s.sidePanelOpenTick);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.kind === "chat") {
      setNav("sessions");
      setSessionSubView("chat");
      useSessionStore.getState().selectSession(navIntent.sessionId);
    } else if (navIntent.kind === "compose-chat") {
      setNav("sessions");
      setSessionSubView("chat");
    } else if (navIntent.kind === "outputs") {
      setNav("sessions");
      setSessionSubView("tools");
    } else if (navIntent.kind === "view") {
      const next = resolveAppNav(navIntent.nav);
      setNav(next);
      if (next === "sessions") setSessionSubView("chat");
    } else if (navIntent.kind === "settings") {
      setNav("settings");
    } else {
      setNav("advanced");
    }
    useUiStore.getState().clearNavIntent();
  }, [navIntent]);

  useEffect(() => {
    if (sidePanelOpenTick > 0) {
      setStepsOpen(true);
    }
  }, [sidePanelOpenTick]);

  const toggleTaskPanel = useCallback(() => {
    setStepsOpen((v) => !v);
  }, []);

  useAppKeyboardShortcuts({
    onNav: goNav,
    onFocusChat: () => {
      setNav("sessions");
      setSessionSubView("chat");
    },
  });

  return (
    <>
      {forceLogoutReason && (
        <ConfirmDialog
          open
          title="会话已过期"
          titleId="force-logout-dialog"
          confirmLabel="重新登录"
          variant="danger"
          hideCancel
          dismissible={false}
          onClose={handleForceLogoutConfirm}
          onConfirm={handleForceLogoutConfirm}
        >
          <p>{forceLogoutReason}</p>
        </ConfirmDialog>
      )}

      <AppErrorBoundary title="工作区加载失败">
        <AppShellEntrance>
          <div className="app-root flex h-full min-h-0 min-w-0 text-[var(--text-primary)]">
            <Sidebar
              active={nav}
              onNavigate={goNav}
              logoSrc={logoSrc}
              version={APP_VERSION}
              taskPanelOpen={stepsOpen}
              onToggleTaskPanel={toggleTaskPanel}
            />

            <div className="app-shell-main flex min-w-0 flex-1 flex-col">
              <AppHeaderBar
                nav={nav}
                onNav={goNav}
                sessionSubView={sessionSubView}
                onSessionSubView={setSessionSubView}
              />

              <div className="flex min-h-0 min-w-0 flex-1">
                <CenterWorkspace
                  nav={nav}
                  sessionSubView={sessionSubView}
                  stepsOpen={stepsOpen}
                  stepsWidth={stepsWidth}
                  onToggleSteps={() => setStepsOpen((v) => !v)}
                  onResizeSteps={onResizeSteps}
                  onNav={goNav}
                />
              </div>
            </div>
          </div>
        </AppShellEntrance>
      </AppErrorBoundary>

      <ExecApprovalDialog />
    </>
  );
}
