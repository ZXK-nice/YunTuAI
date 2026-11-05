import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchProvisionStatus,
  listenProvisionProgress,
  startProvision,
  type ProvisionSnapshot,
} from "../lib/openclaw/provision-bridge";
import {
  isDesktopConnectInFlight,
  requestDesktopConnect,
} from "../lib/openclaw/desktop-connect-scheduler";
import { FIRST_RUN_CONNECT_MAX_MS } from "../lib/openclaw/startup-connect-pipeline";
import {
  isFirstRunGatewayPending,
  markGatewayEverConnected,
  skipFirstRunGatewayGate,
} from "../lib/first-run-gateway";
import { getConnectGateEscapeMs } from "../lib/openclaw/launch-connect-profile";
import { applyFallbackConnectError } from "../lib/connect-with-feedback";
import { humanizeConnectError } from "../lib/openclaw/connect-error-copy";
import { useGatewayStore } from "../stores/gatewayStore";

function provisionNeedsUi(snap: ProvisionSnapshot): boolean {
  return (
    !snap.ready ||
    snap.running ||
    snap.needed ||
    Boolean(snap.error)
  );
}

export type FirstRunGatewayGate = {
  /** 是否处于首次安装网关引导 */
  active: boolean;
  /** 可进入主界面（已连上网关或无需引导） */
  passed: boolean;
  /** 显示 网关 解压/配置进度 */
  showProvision: boolean;
  snapshot: ProvisionSnapshot | null;
  connectLabel: string;
  connectError: string | null;
  retryConnect: () => void;
  /** 连接失败时允许用户跳过门闸先进界面 */
  enterOffline: () => void;
  canEnterOffline: boolean;
  allowOfflineMain: boolean;
};

export function useFirstRunGatewayGate(enabled: boolean): FirstRunGatewayGate {
  const connState = useGatewayStore((s) => s.connState);
  const startupPhase = useGatewayStore((s) => s.startupPhase);
  const lastError = useGatewayStore((s) => s.lastError);
  const [snapshot, setSnapshot] = useState<ProvisionSnapshot | null>(null);
  const [connectPhase, setConnectPhase] = useState<"idle" | "running" | "failed">("idle");
  const [forcedOffline, setForcedOffline] = useState(false);
  const [canEscape, setCanEscape] = useState(false);
  const connectStartedRef = useRef(false);

  const active = enabled && isFirstRunGatewayPending();
  const showProvision = Boolean(snapshot && provisionNeedsUi(snapshot));
  const passed = !active || connState === "connected" || forcedOffline;

  const runConnect = useCallback(() => {
    if (!active || connectStartedRef.current || isDesktopConnectInFlight()) return;
    connectStartedRef.current = true;
    setConnectPhase("running");
    void (async () => {
      const ok = await requestDesktopConnect({
        maxMs: FIRST_RUN_CONNECT_MAX_MS,
        cancelled: () => useGatewayStore.getState().connState === "connected",
      });
      connectStartedRef.current = false;
      if (useGatewayStore.getState().connState === "connected") {
        markGatewayEverConnected();
        setConnectPhase("idle");
        return;
      }
      if (!ok) {
        applyFallbackConnectError();
      }
      setConnectPhase(ok ? "idle" : "failed");
    })();
  }, [active]);

  const retryConnect = useCallback(() => {
    connectStartedRef.current = false;
    setConnectPhase("idle");
    setForcedOffline(false);
    useGatewayStore.getState().cancelReconnect();
    runConnect();
  }, [runConnect]);

  const enterOffline = useCallback(() => {
    skipFirstRunGatewayGate();
    useGatewayStore.getState().cancelReconnect();
    setForcedOffline(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const boot = async () => {
      const snap = await fetchProvisionStatus();
      if (cancelled) return;
      if (snap) setSnapshot(snap);
      if (snap && provisionNeedsUi(snap) && !snap.running && (snap.needed || !snap.ready)) {
        await startProvision().catch(() => undefined);
      }
    };
    void boot();

    const unlistenPromise = listenProvisionProgress((snap) => {
      if (!cancelled) setSnapshot(snap);
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [active]);

  useEffect(() => {
    if (!active || passed || showProvision) return;
    runConnect();
  }, [active, passed, showProvision, runConnect]);

  useEffect(() => {
    if (!active || passed) return;
    if (connectPhase !== "running") return;
    const timer = window.setTimeout(() => {
      const gs = useGatewayStore.getState();
      if (gs.connState === "connected") return;
      if (isDesktopConnectInFlight()) return;
      connectStartedRef.current = false;
      applyFallbackConnectError();
      setConnectPhase("failed");
    }, FIRST_RUN_CONNECT_MAX_MS + 5_000);
    return () => window.clearTimeout(timer);
  }, [active, passed, connectPhase]);

  useEffect(() => {
    if (!enabled) {
      setForcedOffline(false);
      setCanEscape(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!active || passed || forcedOffline) {
      setCanEscape(false);
      return;
    }
    if (connectPhase === "failed") {
      setCanEscape(true);
      return;
    }
    const timer = window.setTimeout(() => setCanEscape(true), getConnectGateEscapeMs());
    return () => window.clearTimeout(timer);
  }, [active, passed, forcedOffline, connectPhase]);

  useEffect(() => {
    if (connState === "connected") {
      markGatewayEverConnected();
    }
  }, [connState]);

  const connectLabel =
    connState === "connected"
      ? "即将进入"
      : startupPhase
        ? startupPhase
        : connectPhase === "running" || connState === "connecting"
          ? "正在连接本机服务…"
          : connectPhase === "failed"
            ? "连接失败，请重试"
            : "正在准备本机服务…";

  return {
    active,
    passed,
    showProvision,
    snapshot,
    connectLabel,
    connectError:
      connectPhase === "failed"
        ? humanizeConnectError(lastError) ||
          lastError?.trim() ||
          "连接本机服务超时或失败，请点「重试」重试。"
        : null,
    retryConnect,
    enterOffline,
    canEnterOffline: canEscape,
    allowOfflineMain: forcedOffline,
  };
}
