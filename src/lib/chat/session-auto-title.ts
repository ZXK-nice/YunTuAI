import {
  ASSISTANT_REPLY_TIMEOUT_NOTICE,
  ASSISTANT_STOPPED_NOTICE,
} from "../openclaw/send-wait";

export const SESSION_TITLE_MAX_CHARS = 36;

const DEFAULT_TITLE_RE = /^新会话(（\d+）|\s+\d+)?$/;

export function isDefaultSessionTitle(title: string): boolean {
  return DEFAULT_TITLE_RE.test(title.trim());
}

function stripForTitle(raw: string): string {
  return raw
    .replace(/---[\s\S]*?\[文件上下文\][\s\S]*/g, "")
    .replace(/\[文件上下文\][\s\S]*/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/（附件[^）]*）/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstClause(text: string): string {
  const t = stripForTitle(text);
  if (!t) return "";
  const parts = t.split(/[。！？!?\n；;，,]/).map((p) => p.trim()).filter(Boolean);
  return parts[0] ?? t;
}

function isWeakTitle(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2) return true;
  if (/^附件/.test(t)) return true;
  if (/^(你好|您好|hi|hello|hey|在吗|帮忙|请|帮我)[!！?？。.]*$/i.test(t)) return true;
  return false;
}

function truncateTitle(text: string, max = SESSION_TITLE_MAX_CHARS): string {
  const t = text.trim();
  if (!t) return "";
  if (t.length <= max) return t;
  if (max <= 1) return "…";
  return `${t.slice(0, max - 1)}…`;
}

/** 去掉用户句首的请求/寒暄套话，保留意图关键词。 */
function extractUserIntentHint(user: string): string {
  let t = stripForTitle(user);
  t = t
    .replace(/^(请|帮我|帮忙|麻烦你?|我想|我要|能否|可以|请问|告诉我|解释一下|说说)\s*/giu, "")
    .replace(/^(如何|怎么|怎样|什么是)\s*/giu, "")
    .trim();
  return firstClause(t);
}

/** 从助手首段回复提取主题短语（偏摘要，而非复述用户原话）。 */
function extractAssistantTopic(text: string): string {
  const t = stripForTitle(text);
  if (!t) return "";

  const patterns = [
    /关于[「"『]?([^「」"'。！？\n]{2,28})[」"』]?的/u,
    /这是[「"『]?([^「」"'。！？\n]{2,28})[」"』]?[。,.]/u,
    /(?:以下是|下面是)[：:]\s*[「"『]?([^「」"'。！？\n]{2,28})[」"』]?/u,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const phrase = m[1].trim();
      if (!isWeakTitle(phrase)) return phrase;
    }
  }

  const trimmed = t
    .replace(
      /^(好的|没问题|当然可以|我来(帮你|为您)?|下面(是)?|以下(是)?)[，,：:\s]*/u,
      "",
    )
    .replace(/^是/u, "")
    .replace(/^一个/u, "")
    .trim();
  return firstClause(trimmed);
}

/** 结合首轮问答生成摘要标题（有助手回复时优先用摘要，不直接照搬用户原句）。 */
function synthesizeExchangeTitle(userMessage: string, assistantMessage: string): string {
  const intent = extractUserIntentHint(userMessage);
  const topic = extractAssistantTopic(assistantMessage);

  if (isWeakTitle(intent) && topic) return topic;
  if (topic && intent) {
    const intentKey = intent.slice(0, Math.min(6, intent.length));
    if (topic.includes(intentKey) || intent.includes(topic.slice(0, 4))) {
      return topic;
    }
    if (topic.length <= 12) return topic;
    return topic.length >= intent.length ? topic : intent;
  }
  return intent || topic;
}

/** 根据首轮用户消息与 AI 回复生成本地会话标题（短、可读）。 */
export function deriveSessionTitle(userMessage: string, assistantMessage?: string): string {
  if (assistantMessage && isTitleableAssistantMessage(assistantMessage)) {
    const synthesized = synthesizeExchangeTitle(userMessage, assistantMessage);
    const titled = truncateTitle(synthesized);
    if (titled && !isWeakTitle(titled)) return titled;
  }

  let candidate = extractUserIntentHint(userMessage);
  if (isWeakTitle(candidate)) {
    const attachmentMatch = userMessage.match(/（附件[：:]\s*([^）]+)/);
    if (attachmentMatch?.[1]) {
      const name = attachmentMatch[1].split(/[、,]/)[0]?.trim();
      if (name) candidate = name.replace(/\.[^.]+$/, "");
    }
  }
  const titled = truncateTitle(candidate);
  return titled || "新对话";
}

export function isTitleableAssistantMessage(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (t === ASSISTANT_STOPPED_NOTICE || t === ASSISTANT_REPLY_TIMEOUT_NOTICE) return false;
  if (t.startsWith("【发送或服务异常】")) return false;
  if (t.startsWith("[错误]")) return false;
  return true;
}

export function shouldAutoTitleSession(
  title: string,
  userMessages: string[],
  assistantMessages: string[],
): boolean {
  if (!isDefaultSessionTitle(title)) return false;
  if (userMessages.length !== 1) return false;
  const realAssistant = assistantMessages.filter(isTitleableAssistantMessage);
  return realAssistant.length === 1;
}
