import { useCallback, useEffect, useState } from "react";
import {
  fetchProvisionStatus,
  listenProvisionProgress,
  startProvision,
  type ProvisionSnapshot,
} from "../lib/openclaw/provision-bridge";
import { isFirstRunGatewayPending } from "../lib/first-run-gateway";
import { isTauriRuntime } from "../lib/tauri-env";

const READY: ProvisionSnapshot = {
  needed: false,
  ready: true,
  running: false,
  phase: "ready",
  percent: 100,
  message: "",
  choiceRequired: false,
  globalAvailable: false,
  bundledReady: false,
  bundledInstallAvailable: false,
  bundledVersion: "",
};

const ERROR_SNAPSHOT: ProvisionSnapshot = {
  needed: true,
  ready: false,
  running: false,
  phase: "error",
  percent: 0,
  message: "本机服务环境检查失败",
  error: "本机服务环境检查失败，请重试",
  choiceRequired: false,
  globalAvailable: false,
  bundledReady: false,
  bundledInstallAvailable: false,
  bundledVersion: "",
};

function provisionNeedsUi(snap: ProvisionSnapshot): boolean {
  return !snap.ready || snap.running || snap.needed || Boolean(snap.error);
}

/** 首帧后再发 IPC，避免阻塞启动动画。 */
function deferAfterFirstPaint(fn: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(fn);
  });
}

export function useOpenClawProvision() {
  const [checking, setChecking] = useState(isTauriRuntime());
  const [snapshot, setSnapshot] = useState<ProvisionSnapshot | null>(
    isTauriRuntime() ? null : READY,
  );

  const refresh = useCallback(async () => {
    const snap = await fetchProvisionStatus();
    if (snap) setSnapshot(snap);
    return snap;
  }, []);

  const retry = useCallback(async () => {
    await startProvision("bundled");
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    const unlistenPromise = listenProvisionProgress((snap) => {
      if (!cancelled) {
        setSnapshot(snap);
        setChecking(false);
      }
    });

    deferAfterFirstPaint(() => {
      void (async () => {
        try {
          const snap = await fetchProvisionStatus();
          if (cancelled) return;
          if (snap) setSnapshot(snap);
        } catch {
          if (cancelled) return;
          setSnapshot(ERROR_SNAPSHOT);
        } finally {
          if (!cancelled) setChecking(false);
        }
      })();
    });

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  const firstRun = isFirstRunGatewayPending();
  const blocking =
    isTauriRuntime() &&
    snapshot != null &&
    firstRun &&
    provisionNeedsUi(snapshot);

  return { checking, snapshot, blocking, refresh, retry };
}
