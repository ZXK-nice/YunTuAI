import { useCallback, useEffect, useState } from "react";
import {
  fetchOpenClawEnvStatus,
  saveOpenClawEnvKeys,
  type OpenClawEnvStatus,
} from "../lib/openclaw/env-bridge";
import { isTauriRuntime } from "../lib/tauri-env";

const READY: OpenClawEnvStatus = {
  bundledManaged: false,
  setupRequired: false,
  apiKeyLocked: false,
  keys: [],
  envPath: "",
};

export function useOpenClawEnvSetup(enabled: boolean) {
  const [initialized, setInitialized] = useState(!isTauriRuntime() || !enabled);
  const [status, setStatus] = useState<OpenClawEnvStatus | null>(
    !isTauriRuntime() || !enabled ? READY : null,
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !isTauriRuntime()) {
      setStatus(READY);
      return READY;
    }
    const snap = await fetchOpenClawEnvStatus();
    if (snap) setStatus(snap);
    return snap;
  }, [enabled]);

  const saveKeys = useCallback(
    async (keys: Record<string, string>) => {
      if (!enabled || !isTauriRuntime()) return null;
      setBusy(true);
      try {
        const snap = await saveOpenClawEnvKeys(keys);
        if (snap) setStatus(snap);
        return snap;
      } finally {
        setBusy(false);
      }
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      setStatus(READY);
      setInitialized(true);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let failStreak = 0;
    let interval: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const snap = await fetchOpenClawEnvStatus();
        if (cancelled) return snap;
        if (snap) {
          failStreak = 0;
          setStatus(snap);
          setInitialized(true);
          if (!snap.setupRequired || snap.apiKeyLocked) {
            if (interval) {
              clearInterval(interval);
              interval = undefined;
            }
          }
        } else {
          failStreak += 1;
          setInitialized(true);
          if (failStreak >= 2) {
            setStatus((prev) => prev ?? { ...READY });
          }
        }
        return snap;
      } finally {
        inFlight = false;
      }
    };

    void poll();
    // 配置页会挡住主界面；2.5s 轮询叠同步鉴权 IPC 容易把窗口打成「未响应」。
    interval = setInterval(() => {
      void poll();
    }, 15_000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [enabled]);

  const checkPending = enabled && isTauriRuntime() && status == null;
  const blocking =
    enabled &&
    isTauriRuntime() &&
    status != null &&
    status.setupRequired &&
    !status.apiKeyLocked;

  return { initialized, status, blocking, checkPending, busy, refresh, saveKeys };
}
