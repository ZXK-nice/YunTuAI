import { useEffect } from "react";
import { useGatewayStore } from "../stores/gatewayStore";
import { useExecApprovalStore } from "../stores/execApprovalStore";
import { isTauriRuntime } from "../lib/tauri-env";

/** 连接后拉取待审批队列；网关事件由 gatewayStore 转发，不再定时轮询。 */
export function useExecApprovalBridge() {
  const connected = useGatewayStore((s) => s.connState === "connected");
  const refresh = useExecApprovalStore((s) => s.refresh);

  useEffect(() => {
    if (!isTauriRuntime() || !connected) return;
    const t = window.setTimeout(() => {
      void refresh();
    }, 600);
    return () => window.clearTimeout(t);
  }, [connected, refresh]);
}
