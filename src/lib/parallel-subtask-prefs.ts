const STORAGE_KEY = "yuntu-parallel-subtask-enabled-v1";

/** 并行子任务默认开启；用户可在任务侧栏一键关闭，避免多 Agent 额外消耗 remote session / tokens。 */
export function isParallelSubtaskEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function persistParallelSubtaskEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    /* ignore */
  }
}
