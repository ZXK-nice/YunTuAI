/** 超时包装：到点 reject，并清掉计时器。晚到的结果或错误不再变成未处理拒绝。底层 IPC 无法从 JS 侧取消。 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(label ? `${label} 超时 (${timeoutMs}ms)` : `操作超时 (${timeoutMs}ms)`));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function isIpcTimeoutError(message: string): boolean {
  return /超时 \(\d+ms\)/.test(message) || /\btimeout\b/i.test(message);
}

/** 用户可见：不要把 `db_list_sessions 超时 (10000ms)` 这类 IPC 原文丢到 Toast。 */
export function humanizeIpcFailure(message: string): string {
  const t = message.trim();
  if (!t) return "本机操作未完成，请稍候重试。";
  if (isIpcTimeoutError(t)) {
    return "本机正在启动，读写稍忙。请稍候，或点顶栏「重连」。";
  }
  return t;
}

/** 可取消的 sleep；signal 已 abort 时立即返回 "aborted"。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<"aborted" | void> {
  if (signal?.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const onAbort = () => {
      cleanup();
      resolve("aborted");
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
