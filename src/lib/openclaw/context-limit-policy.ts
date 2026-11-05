import { isCompactionRecoveryError } from "./compaction-recovery";

/** 聊天区展示「上下文偏大」横幅的估算 token 阈值。 */
export const CONTEXT_PRESSURE_TOKENS = 28_000;

/** 发送前主动 `sessions.compact` 的估算 token 阈值（长任务 PDF/多轮工具时提前压缩）。 */
export const CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS = 10_000;

/** 超过此阈值时发送前双次压缩；仍失败则阻断发送并提示用户。 */
export const CONTEXT_FORCE_COMPACT_TOKENS = 20_000;

export const CONTEXT_LIMIT_ACTION_HINT =
  "建议：① 点击「压缩上下文」；② 换用更大上下文的模型（如 DeepSeek V4 Flash）；③ 或新建对话继续。";

/** CJK 统一表意文字与全角标点：DeepSeek 等主流分词器约每字 1 token。 */
const CJK_CHAR_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF01-\uFF5E]/g;

export function countCjkChars(text: string): number {
  if (!text) return 0;
  const m = text.match(CJK_CHAR_RE);
  return m ? m.length : 0;
}

/**
 * 估算 token：CJK 每字约 1 token，拉丁字母/数字/空白约每 4 字符 1 token。
 * 相比旧版「chars/2」，中文长对话不再低估近一倍，英文/代码也不再高估。
 */
export function estimateSessionTokensFromChars(
  charCount: number,
  cjkCharCount?: number,
): number {
  if (charCount <= 0) return 0;
  const cjk = Math.max(0, Math.min(cjkCharCount ?? 0, charCount));
  const latin = charCount - cjk;
  return Math.ceil(cjk + latin / 4);
}

export function estimateSessionTokens(messages: { content: string }[]): number {
  let chars = 0;
  let cjk = 0;
  for (const m of messages) {
    chars += m.content.length;
    cjk += countCjkChars(m.content);
  }
  return estimateSessionTokensFromChars(chars, cjk);
}

export function isContextPressure(tokens: number): boolean {
  return tokens >= CONTEXT_PRESSURE_TOKENS;
}

/** 网关/模型返回的上下文或 token 上限类错误。 */
export function isContextLimitError(message: string): boolean {
  if (isCompactionRecoveryError(message)) return true;
  const m = message.toLowerCase();
  return (
    m.includes("context length") ||
    m.includes("maximum context") ||
    m.includes("max context") ||
    m.includes("context window") ||
    m.includes("context_window") ||
    m.includes("token limit") ||
    m.includes("too many tokens") ||
    m.includes("prompt is too long") ||
    m.includes("input is too long") ||
    m.includes("request too large") ||
    m.includes("exceeds the context") ||
    m.includes("context_limit") ||
    (m.includes("context") && m.includes("exceed")) ||
    (m.includes("tokens") && m.includes("limit"))
  );
}

export function humanizeContextLimitError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return `对话上下文已满或接近模型上限。${CONTEXT_LIMIT_ACTION_HINT}`;
  }
  if (!isContextLimitError(trimmed)) return trimmed;
  return `对话上下文已满或接近模型上限。${CONTEXT_LIMIT_ACTION_HINT}`;
}

export function contextPressureBannerText(approxTokens: number): string {
  return `对话上下文约 ${approxTokens.toLocaleString()} tokens，已接近模型上限。建议压缩上下文，或换用更大上下文的模型后再继续长任务。`;
}
