import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { isTauriRuntime } from "./tauri-env";

export type LaunchContext = {
  trayMode: boolean;
  freshSystemBoot: boolean;
  legacyStartupBat: boolean;
  startupGraceMs: number;
};

export async function fetchLaunchContext(): Promise<LaunchContext | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<LaunchContext>("yuntuai_launch_context");
  } catch {
    return null;
  }
}

export async function fetchAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return isEnabled();
}

export async function setAutostartEnabled(on: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  if (import.meta.env.DEV) {
    throw new Error(
      "开发版不支持写入开机自启（会指向 localhost:1420，开机后无法加载界面）。请使用正式安装包并在「设置 → 启动与托盘」中开启。",
    );
  }
  if (on) {
    await enable();
  } else {
    await disable();
  }
}
