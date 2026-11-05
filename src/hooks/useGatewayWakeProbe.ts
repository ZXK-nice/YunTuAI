import { useEffect, useRef } from "react";
import { runGatewayWakeProbe, type WakeProbeState } from "../lib/openclaw/gateway-wake-probe";
import { isTauriRuntime } from "../lib/tauri-env";
import { useGatewayStore } from "../stores/gatewayStore";
import { useSessionStore } from "../stores/sessionStore";

let moduleWakeState: WakeProbeState = {
  lastWakeProbeAt: 0,
  wakeProbeFailStreak: 0,
};

/** 休眠唤醒 / 回前台 / 网络恢复后探活网关，减少「假连接」。 */
export function useGatewayWakeProbe() {
  const stateRef = useRef(moduleWakeState);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test") return;

    const probe = async () => {
      const gw = useGatewayStore.getState();
      stateRef.current = await runGatewayWakeProbe({
        state: stateRef.current,
        gateway: {
          connState: gw.connState,
          autoReconnect: gw.autoReconnect,
          cancelReconnect: () => gw.cancelReconnect(),
          disconnect: () => gw.disconnect(),
        },
        isSending: useSessionStore.getState().isSending,
      });
      moduleWakeState = stateRef.current;
    };

    const onWake = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      void probe();
    };

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, []);
}
