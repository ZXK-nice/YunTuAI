import { getFlag, getItem, removeItem, setFlag, setItem } from "./safeStorage";

/** localStorage：远程 latest.json 地址 */
export const LS_UPDATE_MANIFEST_URL = "yuntuai.update.manifestUrl";

/** localStorage：登录后自动检查更新（1/0） */
export const LS_UPDATE_AUTO_CHECK = "yuntuai.update.autoCheck";

/** 构建时可设 VITE_UPDATE_MANIFEST_URL 作为默认更新源 */
const BUILD_DEFAULT_MANIFEST_URL =
  typeof import.meta.env.VITE_UPDATE_MANIFEST_URL === "string"
    ? import.meta.env.VITE_UPDATE_MANIFEST_URL.trim()
    : "";

export function getUpdateManifestUrl(): string {
  const saved = getItem(LS_UPDATE_MANIFEST_URL)?.trim();
  if (saved) return saved;
  return BUILD_DEFAULT_MANIFEST_URL;
}

export function setUpdateManifestUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed) setItem(LS_UPDATE_MANIFEST_URL, trimmed);
  else removeItem(LS_UPDATE_MANIFEST_URL);
}

export function getUpdateAutoCheck(): boolean {
  return getFlag(LS_UPDATE_AUTO_CHECK);
}

export function setUpdateAutoCheck(enabled: boolean): void {
  setFlag(LS_UPDATE_AUTO_CHECK, enabled);
}

export type UpdateCheckResult = {
  currentVersion: string;
  available: boolean;
  latestVersion?: string;
  notes?: string;
  downloadUrl?: string;
  sha256?: string;
  errorHint?: string;
};
