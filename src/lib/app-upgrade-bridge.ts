import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./tauri-env";

export type UpgradeNotice = {
  fromVersion: string | null;
  toVersion: string;
  hints: string[];
};

export async function consumeUpgradeNotice(): Promise<UpgradeNotice | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<UpgradeNotice | null>("yuntuai_consume_upgrade_notice");
  } catch {
    return null;
  }
}
