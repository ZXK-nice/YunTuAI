import { sleepWithSignal } from "../async-utils";

/** 等待 WebSocket 路径 abort 信号（由 applyGatewayChatEvent 在 final 时触发）。 */
export function waitForAbortSignal(
  signal: AbortSignal,
  timeoutMs: number,
): Promise<"aborted" | "timeout"> {
  if (signal.aborted) return Promise.resolve("aborted");
  return new Promise((resolve) => {
    const onAbort = () => {
      cleanup();
      resolve("aborted");
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve("timeout");
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 等待 WS abort 信号，但超时判定为**空闲超时**：只要后端还在产生事件（由 `getLastActivityMs`
 * 汇报最新活动时间戳），超时倒计时就自动续命。
 *
 * 适用于后端执行长时间任务（工具调用、深度思考、代码执行等）的场景，避免固定超时误判中断。
 *
 * @param signal               AbortController.signal，abort 时立即返回 `"aborted"`
 * @param idleTimeoutMs        连续 idle 超过此毫秒数视为超时
 * @param getLastActivityMs    返回最近一次 WS 活动时间戳（`Date.now()`）的回调
 * @param checkIntervalMs      间隔检查 ms（默认 5s）
 */
export function waitForAbortSignalWithIdleCheck(
  signal: AbortSignal,
  idleTimeoutMs: number,
  getLastActivityMs: () => number,
  checkIntervalMs = 5_000,
): Promise<"aborted" | "timeout"> {
  if (signal.aborted) return Promise.resolve("aborted");

  let cleanup: () => void;
  return new Promise<"aborted" | "timeout">((resolve) => {
    const done = () => {
      cleanup();
      resolve("aborted");
    };
    signal.addEventListener("abort", done, { once: true });

    const tick = () => {
      if (signal.aborted) {
        done();
        return;
      }
      if (Date.now() - getLastActivityMs() >= idleTimeoutMs) {
        cleanup();
        resolve("timeout");
      }
    };

    const id = window.setInterval(tick, checkIntervalMs);
    cleanup = () => window.clearInterval(id);

    // 首次检查立即执行
    tick();
  });
}

/**
 * 等待 WS abort 信号，带网关活性检测。
 *
 * 与 waitForAbortSignalWithIdleCheck 类似，但当空闲超时触发时，会先探活网关：
 * - 网关存活 → 重置空闲计时器，继续等待
 * - 网关已死 → 返回 "timeout"，触发后续兜底逻辑
 *
 * 解决仅 chat 事件重置计时器的问题：pipeline/tool 事件现在通过全局时间戳
 * （`getLastActivityMs` 应返回 max(per-session lastWsEventAt, global lastAnyWsEventMs)）
 * 合并计入空闲判定，同时活性检测确保即使长时间无事件，只要网关活着就不会误杀。
 *
 * @param signal               AbortController.signal，abort 时立即返回 "aborted"
 * @param baseIdleTimeoutMs    连续无活动超过此毫秒数时触发活性检测
 * @param getLastActivityMs    返回最近一次综合活动时间戳的回调
 * @param checkGatewayLiveness 网关活性探测回调，返回 true 表示存活
 * @param checkIntervalMs      间隔检查 ms（默认 5s）
 */
export async function waitForAbortSignalWithLivenessCheck(
  signal: AbortSignal,
  baseIdleTimeoutMs: number,
  getLastActivityMs: () => number,
  checkGatewayLiveness: () => Promise<boolean>,
  checkIntervalMs = 5_000,
): Promise<"aborted" | "timeout"> {
  if (signal.aborted) return Promise.resolve("aborted");

  let timerId: ReturnType<typeof setInterval> | null = null;
  let lastLivenessOkAt = 0;

  return new Promise<"aborted" | "timeout">((resolve) => {
    const onAbort = () => {
      cleanup();
      resolve("aborted");
    };
    signal.addEventListener("abort", onAbort, { once: true });

    let livenessInFlight = false;

    const tick = () => {
      if (signal.aborted) {
        onAbort();
        return;
      }
      // 综合考虑：实际 WS 事件活动 + 最后一次活性检测通过时间
      const lastActivity = Math.max(getLastActivityMs(), lastLivenessOkAt);
      if (Date.now() - lastActivity < baseIdleTimeoutMs) {
        return;
      }

      if (livenessInFlight) return;
      livenessInFlight = true;

      checkGatewayLiveness()
        .then((alive) => {
          livenessInFlight = false;
          if (signal.aborted) return;
          if (alive) {
            lastLivenessOkAt = Date.now();
          } else {
            cleanup();
            resolve("timeout");
          }
        })
        .catch(() => {
          livenessInFlight = false;
          if (!signal.aborted) {
            cleanup();
            resolve("timeout");
          }
        });
    };

    timerId = setInterval(tick, checkIntervalMs);
    tick();

    const cleanup = () => {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      signal.removeEventListener("abort", onAbort);
    };
  });
}

/**
 * 发送后轮询 history 中的助手错误行（如上游 403 / API Key 无效），
 * 一旦发现即返回，供主流程提前 abort，避免长时间卡在「整理回答中」。
 */
export async function probeAssistantErrorDuringSend(
  fetchError: () => Promise<string | undefined>,
  signal: AbortSignal,
  opts?: { intervalMs?: number; maxMs?: number },
): Promise<string | undefined> {
  const intervalMs = opts?.intervalMs ?? 800;
  const maxMs = opts?.maxMs ?? 180_000;
  const start = Date.now();
  let first = true;
  while (!signal.aborted && Date.now() - start < maxMs) {
    if (!first) {
      const w = await sleepWithSignal(intervalMs, signal);
      if (w === "aborted" || signal.aborted) return undefined;
    }
    first = false;
    try {
      const err = await fetchError();
      if (err) return err;
    } catch {
      /* ignore probe errors */
    }
  }
  return undefined;
}

export const ASSISTANT_REPLY_TIMEOUT_NOTICE =
  "【暂未收到任务正文】已等待较长时间，仍未发现新的回复。\n\n可能原因：本机服务已退出、模型仍在生成但无中间输出、仅执行了工具步骤、或服务较慢。请展开右侧「任务进度」查看；也可在「日志」中核对。\n\n若使用本机 Ollama，请确认模型已加载且显存/内存充足。需要时点「重试发送」。";

/**
 * 连续无活动硬顶：仅在网关长时间无任何 WS/工具事件时才停止等待。
 * 有中间输出的长任务可一直跑，只有用户点「停止」才会主动中止。
 */
export const ASSISTANT_SEND_HARD_CAP_NOTICE =
  "【等待超时】已连续 2 小时未收到任何任务进展。已停止等待；若网关仍在执行，请稍后查看对话历史与右侧产出，或点击停止后重试。";

/** 连续无活动超过此时长才触发硬顶（非从发送起算的绝对墙钟）。 */
export const SEND_HARD_CAP_MS = 2 * 60 * 60_000;

export const ASSISTANT_STOPPED_NOTICE =
  "【已停止】本轮任务已停止；若有部分内容已生成，请见上文。";
