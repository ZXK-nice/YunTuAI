const STORAGE_KEY = "yuntu-auto-continue-incomplete-v1";

/** 默认开启：仅规划/工具截断时自动续跑。 */
export function readAutoContinueIncomplete(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistAutoContinueIncomplete(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    /* ignore */
  }
}
