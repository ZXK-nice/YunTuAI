import { useUiStore } from "../stores/uiStore";
import { isInStartupGrace } from "./openclaw/gateway-recovery";

let installed = false;

const BENIGN_ASYNC_ERROR =
  /openclaw_env_status_cmd 超时|prepareGateway 超时|gatewayConnect 超时|startupConnect 超时/;

/** 捕获未处理的 Promise 拒绝与运行时错误，避免静默失败。 */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "未知异步错误";
    console.error("[unhandledrejection]", reason);
    if (import.meta.env.MODE !== "test") {
      if (BENIGN_ASYNC_ERROR.test(msg) || isInStartupGrace()) {
        event.preventDefault();
        return;
      }
      useUiStore.getState().showToast(`未捕获错误：${msg.slice(0, 120)}`, "error");
    }
    event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    console.error("[window.error]", event.error ?? event.message);
    if (import.meta.env.MODE !== "test" && event.message) {
      useUiStore.getState().showToast(`运行错误：${event.message.slice(0, 120)}`, "error");
    }
  });
}
