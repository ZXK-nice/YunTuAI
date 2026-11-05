import { listen } from "@tauri-apps/api/event";
import type { OpenClawExclusiveReport } from "./cli-bridge";
import type { GatewayLifecycleSnapshot } from "./gateway-lifecycle";
import { isTauriRuntime } from "../tauri-env";

export function listenMainWindowShown(handler: () => void): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<void>("yuntuai-main-window-shown", () => {
    handler();
  });
}

export function listenGatewaySupervisorUnhealthy(handler: () => void): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<void>("gateway-supervisor-unhealthy", () => {
    handler();
  });
}

export function listenGatewayLifecycleState(
  handler: (snapshot: GatewayLifecycleSnapshot) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<GatewayLifecycleSnapshot>("gateway-lifecycle-state", (event) => {
    handler(event.payload);
  });
}

export function listenGatewayExclusiveReport(
  handler: (report: OpenClawExclusiveReport) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<OpenClawExclusiveReport>("gateway-exclusive-report", (event) => {
    handler(event.payload);
  });
}
