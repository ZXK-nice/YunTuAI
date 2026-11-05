import { useCallback, useEffect, useRef, useState } from "react";
import { useGatewayStore } from "../stores/gatewayStore";
import {
  applyLaunchStartupGrace,
  markGatewayRecoveryAppStart,
} from "../lib/openclaw/gateway-recovery";
import { fetchLaunchContext } from "../lib/app-launch-bridge";
import {
  applyLaunchConnectProfile,
  getConnectGateEscapeMs,
  getLaunchConnectProfile,
  type LaunchConnectProfile,
} from "../lib/openclaw/launch-connect-profile";
import { prepareConnectGateThenDesktopConnect } from "../lib/openclaw/connect-gate-prep";
import {
  isDesktopConnectInFlight,
} from "../lib/openclaw/desktop-connect-scheduler";
import {
  applyFallbackConnectError,
  ensureBackgroundConnecting,
} from "../lib/connect-with-feedback";
import { humanizeConnectError } from "../lib/openclaw/connect-error-copy";
import { isTauriRuntime } from "../lib/tauri-env";

/** 连接门等待超过该时间后展示「先进入界面」出口（开发版更短，见 getConnectGateEscapeMs） */
export const CONNECT_GATE_ESCAPE_MS = 30_000;

export type PostLoginConnectGate = {
  /** 未连上且用户未选择离线进入时，挡住主界面 */
  gated: boolean;
  label: string;
  error: string | null;
  retry: () => void;
  /** 连接失败时允许用户跳过门闸先进界面（AppShell 内仍会自动重连） */
  enterOffline: () => void;
  /** 用户已选择离线进入：App 不得因未连接再挡在准备屏 */
  allowOfflineMain: boolean;
  /** 连接门等待超过阈值后出现「离线进入」出口 */
  canEscape: boolean;
};

let launchInitPromise: Promise<void> | null = null;

/** 门闸独立于 AppShell 时，先补齐 bootstrap 里的启动参数初始化（幂等）。 */
function ensureLaunchContextInit(): Promise<void> {
  if (launchInitPromise) return launchInitPromise;
  launchInitPromise = (async () => {
    if (!isTauriRuntime()) return;
    const ctx = await fetchLaunchContext();
    if (ctx?.startupGraceMs) applyLaunchStartupGrace(ctx.startupGraceMs);
    applyLaunchConnectProfile(ctx);
    markGatewayRecoveryAppStart();
  })().catch(() => undefined);
  return launchInitPromise;
}

async function prepareAndConnect(profile: LaunchConnectProfile): Promise<boolean> {
  return prepareConnectGateThenDesktopConnect(profile, { context: "连接本机服务" });
}

/**
 * 每次打开后，连上本机服务之前停在加载页。用户点「先进入」或本轮已经进过主界面后，断线不再整页挡住。
 * 首启 provision 仍由 useFirstRunGatewayGate 处理。
 */
export function usePostLoginConnectGate(enabled: boolean): PostLoginConnectGate {
  const connState = useGatewayStore((s) => s.connState);
  const startupPhase = useGatewayStore((s) => s.startupPhase);
  const lastError = useGatewayStore((s) => s.lastError);
  const reconnectDueAt = useGatewayStore((s) => s.reconnectDueAt);
  const [forcedOffline, setForcedOffline] = useState(false);
  const [manualAttempt, setManualAttempt] = useState(0);
  const [canEscape, setCanEscape] = useState(false);
  const startedRef = useRef(false);
  /** 网关侧已排程自动重连（退避中），不算终态失败 */
  const pendingReconnect = reconnectDueAt != null && reconnectDueAt > 0;

  useEffect(() => {
    if (!enabled) {
      setForcedOffline(false);
      setCanEscape(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || forcedOffline || connState === "connected") {
      setCanEscape(false);
      return;
    }
    if (connState === "error" && !(reconnectDueAt != null && reconnectDueAt > 0)) {
      setCanEscape(true);
      return;
    }
    const timer = window.setTimeout(() => setCanEscape(true), getConnectGateEscapeMs());
    return () => window.clearTimeout(timer);
  }, [enabled, forcedOffline, connState, reconnectDueAt, manualAttempt]);

  const attemptConnect = useCallback(
    (isRetry: boolean) => {
      if (isDesktopConnectInFlight()) return;
      ensureBackgroundConnecting();
      const profile = getLaunchConnectProfile();
      void ensureLaunchContextInit().then(() => {
        if (isRetry) {
          const gw = useGatewayStore.getState();
          gw.cancelReconnect();
          void useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);
          void prepareAndConnect(profile).then((ok) => {
            if (!ok && useGatewayStore.getState().connState !== "connected") {
              applyFallbackConnectError();
            }
          });
          return;
        }
        void prepareAndConnect(profile);
      });
    },
    [],
  );

  useEffect(() => {
    if (!enabled || forcedOffline) return;
    if (connState === "connected") return;
    if (!startedRef.current && !isDesktopConnectInFlight()) {
      startedRef.current = true;
      attemptConnect(false);
    }
  }, [enabled, connState, forcedOffline, manualAttempt, attemptConnect]);

  const passed = connState === "connected";
  const gated = enabled && !forcedOffline && !passed;
  const failed = connState === "error" && !pendingReconnect;

  const label = passed
    ? "即将进入"
    : startupPhase
      ? startupPhase
      : pendingReconnect
        ? "连接失败，自动重连中…"
        : connState === "connecting" || (connState === "disconnected" && gated)
          ? "正在连接本机服务（通常 15–60 秒，请稍候）…"
          : failed
            ? "连接失败，请重试"
            : "正在准备本机服务…";

  const retry = useCallback(() => {
    startedRef.current = true;
    setManualAttempt((n) => n + 1);
    attemptConnect(true);
  }, [attemptConnect]);

  const enterOffline = useCallback(() => {
    useGatewayStore.getState().cancelReconnect();
    setForcedOffline(true);
  }, []);

  return {
    gated,
    label,
    error: failed
      ? humanizeConnectError(lastError?.trim() || "连接本机服务失败，请重试；将自动重连直至成功。")
      : null,
    retry,
    enterOffline,
    allowOfflineMain: forcedOffline,
    canEscape,
  };
}
