import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readPersistedAuthToken, invokeWithAuthRetry } from "../tauri-invoke";
import { getAuthToken } from "../../stores/authStore";
import { isTauriRuntime } from "../tauri-env";
import { withTimeout } from "../async-utils";

export type RuntimeSourceChoice = "bundled" | "global";

export interface ProvisionSnapshot {
  needed: boolean;
  ready: boolean;
  running: boolean;
  phase: string;
  percent: number;
  message: string;
  error?: string | null;
  choiceRequired: boolean;
  globalAvailable: boolean;
  globalVersion?: string | null;
  bundledReady: boolean;
  bundledInstallAvailable: boolean;
  bundledVersion: string;
  runtimeSource?: string | null;
}


export async function fetchProvisionStatus(): Promise<ProvisionSnapshot | null> {
  if (!isTauriRuntime()) return null;
  return withTimeout(
    invoke<ProvisionSnapshot>("openclaw_provision_status"),
    6_000,
    "openclaw_provision_status",
  ).catch(() => null);
}

function optionalAuthToken(): string | null {
  return getAuthToken()?.trim() || readPersistedAuthToken()?.trim() || null;
}

export async function startProvision(source: RuntimeSourceChoice = "bundled"): Promise<void> {
  if (!isTauriRuntime()) return;
  const token = optionalAuthToken();
  // 已登录：带 token，后端允许 stop_all；首启未登录：token=null，仅安装不 blast 停网关
  await invoke("openclaw_provision_start", { source, token });
}

export async function setRuntimePreference(source: RuntimeSourceChoice): Promise<void> {
  if (!isTauriRuntime()) return;
  const token = optionalAuthToken();
  await invoke("openclaw_runtime_set", { source, token });
}

/** 切换内置/本机 OpenClaw（停网关、清理进程、保存偏好、重新配置）。 */
export async function switchRuntimePreference(source: RuntimeSourceChoice): Promise<void> {
  if (!isTauriRuntime()) return;
  await invokeWithAuthRetry("openclaw_runtime_switch", { source });
}

export function listenProvisionProgress(
  handler: (snap: ProvisionSnapshot) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<ProvisionSnapshot>("openclaw-provision-progress", (event) => {
    handler(event.payload);
  });
}

import { runtimeSourceLabel } from "../product-copy";

export { runtimeSourceLabel };
