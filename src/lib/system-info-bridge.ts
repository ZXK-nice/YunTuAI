import { invokeAuthed } from "./tauri-invoke";

export type RuntimeCheckItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type SystemInfoReport = {
  appVersion: string;
  os: string;
  arch: string;
  installDir: string;
  dataDir: string;
  openclawDataDir: string;
  fingerprint: string;
  webview2Installed: boolean;
  runtimeChecks: RuntimeCheckItem[];
};

export async function fetchSystemInfo(): Promise<SystemInfoReport | null> {
  return invokeAuthed<SystemInfoReport>("app_system_info");
}
