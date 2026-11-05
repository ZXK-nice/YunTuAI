import { useCallback, useState } from "react";
import {
  cliGatewayHealthJson,
  cliGatewayRestart,
  cliGatewayStart,
  cliGatewayStop,
  type GatewayCliResult,
} from "../lib/openclaw/cli-bridge";
import { isTauriRuntime } from "../lib/tauri-env";
import { notifyGatewayRestartPending } from "../lib/openclaw/gateway-restart-notice";
import { useGatewayStore } from "../stores/gatewayStore";
import { useUiStore } from "../stores/uiStore";

export type GatewayServiceAction = "start" | "stop" | "restart" | "health";

export function useGatewayServiceActions() {
  const [busy, setBusy] = useState<GatewayServiceAction | null>(null);
  const [lastResult, setLastResult] = useState<GatewayCliResult | null>(null);
  const [lastLabel, setLastLabel] = useState("");
  const showToast = useUiStore((s) => s.showToast);
  const wsUrl = useGatewayStore((s) => s.wsUrl);
  const disconnect = useGatewayStore((s) => s.disconnect);
  const connect = useGatewayStore((s) => s.connect);

  const runAction = useCallback(
    async (action: GatewayServiceAction, options?: { reconnect?: boolean; showOutput?: boolean }) => {
      if (!isTauriRuntime()) {
        showToast("请在桌面版中控制本机服务", "error");
        return null;
      }
      if (action === "stop" || action === "restart") {
        if (action === "restart") notifyGatewayRestartPending("手动重启");
        disconnect();
      }
      setBusy(action);
      if (options?.showOutput) {
        setLastResult(null);
        setLastLabel("");
      }
      try {
        const run =
          action === "start"
            ? cliGatewayStart()
            : action === "stop"
              ? cliGatewayStop()
              : action === "restart"
                ? cliGatewayRestart()
                : cliGatewayHealthJson(wsUrl);
        const r = await run;
        if (options?.showOutput) {
          setLastResult(r);
          setLastLabel(
            action === "health"
              ? "健康检查"
              : action === "start"
                ? "启动"
                : action === "stop"
                  ? "停止"
                  : "重启",
          );
        }
        if (!r?.ok) {
          const detail = (r?.stderr || r?.stdout || "未知错误").trim().slice(0, 220);
          showToast(
            `${action === "health" ? "健康检查" : action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}未成功: ${detail}`,
            "error",
          );
          return r;
        }
        if (action === "health") {
          showToast("健康检查完成", "success");
        } else if (action === "stop") {
          showToast("本机服务已停止", "success");
        } else {
          showToast("本机服务已就绪", "success");
          if (options?.reconnect !== false) {
            await new Promise((resolve) => setTimeout(resolve, 900));
            await connect().catch(() => showToast("服务已起，但 WebSocket 重连失败", "info"));
          }
        }
        return r;
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [connect, disconnect, showToast, wsUrl],
  );

  return { busy, lastResult, lastLabel, runAction };
}
