const STORAGE_KEY = "yuntu-llm-handoff-summary-v1";

/** 「摘要并新建」默认用模型生成更短的接续摘要（显式用户操作，可接受一次额外模型调用）。 */
export function isLlmHandoffSummaryEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistLlmHandoffSummaryEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    /* ignore */
  }
}
