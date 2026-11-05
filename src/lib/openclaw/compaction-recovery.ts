import { gatewaySessionCompact } from "./console-control";
import {
  CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS,
  CONTEXT_FORCE_COMPACT_TOKENS,
} from "./context-limit-policy";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** OpenClaw 网关 auto-compaction 失败时的典型报错。 */
export function isCompactionRecoveryError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("auto-compaction could not recover") ||
    m.includes("compaction could not recover") ||
    (m.includes("compaction") && m.includes("reservetokensfloor"))
  );
}

/** 用户可读的 compaction 失败说明（避免把英文网关原文写入聊天气泡）。 */
export function humanizeCompactionRecoveryError(message: string): string {
  if (!isCompactionRecoveryError(message)) return message.trim();
  return (
    "对话上下文过长，自动压缩未能完成。建议：① 点击侧栏「压缩上下文」；② 新建对话继续长任务；③ 或在设置中换用更大上下文的模型。"
  );
}

/** 对当前办事会话执行 `sessions.compact`（可带一次退避重试）。 */
export async function tryCompactionRecoveryForSession(
  sessionKey: string,
  opts?: { retries?: number },
): Promise<boolean> {
  const key = sessionKey.trim();
  if (!key) return false;
  const retries = Math.max(0, opts?.retries ?? 1);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await gatewaySessionCompact(key);
      if (!res.ok) continue;
      const payload = res.data as { compacted?: boolean; ok?: boolean } | undefined;
      if (payload && payload.compacted === false) continue;
      return true;
    } catch {
      /* retry */
    }
    if (attempt < retries) await delay(600 + attempt * 400);
  }
  return false;
}

export type PrepareSessionForSendResult = {
  compacted: boolean;
  /** 上下文极大且压缩失败：调用方应提示用户而非硬发 */
  blocked: boolean;
};

/**
 * 发送前压缩管线：长任务提前压、超大上下文双次压缩，降低 auto-compaction 崩溃概率。
 */
export async function prepareSessionForSend(
  sessionKey: string,
  approxTokens: number,
  opts?: { forceTaskMode?: boolean },
): Promise<PrepareSessionForSendResult> {
  const threshold = opts?.forceTaskMode
    ? Math.min(CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS, 10_000)
    : CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS;
  if (approxTokens < threshold) {
    return { compacted: false, blocked: false };
  }

  const compacted = await tryCompactionRecoveryForSession(sessionKey, { retries: 1 });
  if (approxTokens >= CONTEXT_FORCE_COMPACT_TOKENS && !compacted) {
    await delay(900);
    const second = await tryCompactionRecoveryForSession(sessionKey, { retries: 1 });
    return { compacted: second, blocked: !second };
  }
  return { compacted, blocked: false };
}

/** 发送前：本地可见上下文偏大时主动压缩，降低 auto-compaction 失败概率。 */
export async function maybeCompactBeforeSend(
  sessionKey: string,
  approxTokens: number,
  opts?: { thresholdTokens?: number },
): Promise<boolean> {
  const threshold = opts?.thresholdTokens ?? CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS;
  if (approxTokens < threshold) return false;
  return tryCompactionRecoveryForSession(sessionKey);
}
