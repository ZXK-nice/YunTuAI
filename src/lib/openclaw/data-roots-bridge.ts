import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

export type OpenClawDataRootEntry = {
  path: string;
  label: string;
  isActive: boolean;
  hasOpenClawJson: boolean;
  skillDirCount: number;
  modifiedMs: number | null;
};

export type OpenClawDataRootsReport = {
  activePath: string;
  entries: OpenClawDataRootEntry[];
  hasDuplicates: boolean;
};

const NOTICE_KEY = "yuntuai:openclaw-data-dup-notice";

export function openClawDataDupNoticeDismissed(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissOpenClawDataDupNotice(): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export async function fetchOpenClawDataRoots(): Promise<OpenClawDataRootsReport | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeAuthed<OpenClawDataRootsReport>("openclaw_scan_data_roots_cmd");
  } catch {
    return null;
  }
}

export async function switchOpenClawDataRoot(path: string): Promise<OpenClawDataRootsReport | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeAuthed<OpenClawDataRootsReport>("openclaw_switch_data_root_cmd", { path });
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}
