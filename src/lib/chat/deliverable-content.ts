/**
 * 判断 assistant 正文是否「可交付给用户」；剥离泄露到正文的推理/中间态。
 */

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const ENGLISH_REASONING_START =
  /^(let me |i understand |i need to |the user |i'll |i will |first,|okay,|ok,|so,|now,|looking at|based on|checking |the precheck|the pending)/i;

const DELIVERABLE_MARKERS = [
  "**✅",
  "**⚠️",
  "\n\n**✅",
  "\n\n**⚠️",
  "\n**✅",
  "\n**⚠️",
  "**请确认**",
  "轮询已在后台",
  "【任务已执行】",
  "【任务完成】",
  "平台×视频",
  "platform×",
];

const INTERIM_STATUS_RE =
  /后台(?:持续)?轮询|跟踪中|出终态即汇报|无需你操作|终态会自动汇报|正在上传|其余\s*pending/i;

/** 仅有规划、尚无路径/文件/结论标记的短回复。 */
const PLANNING_ONLY_RE =
  /^(?:让我|我来|接下来|下面|准备|正在|先|需要|将|打算).{0,120}(?:搜索|检索|查询|执行|调用|批量|继续|写入|生成|整理|汇总)/;

const TERMINAL_JOB_STATUS_RE =
  /\b(completed|partial_failed|failed)\b.*\b(items?|条)\b|平台\s*[×x]\s*视频\s*[×x]\s*status/i;

function latinRatio(text: string): number {
  const sample = text.slice(0, 1200);
  if (!sample) return 0;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  return latin / sample.length;
}

function findDeliverableSectionStart(text: string): number {
  let best = -1;
  for (const marker of DELIVERABLE_MARKERS) {
    const idx = text.lastIndexOf(marker);
    if (idx > best) best = idx;
  }
  if (best >= 0) return best;
  const cnBlock = text.search(/[\u4e00-\u9fff].{8,}/);
  if (cnBlock > 80 && latinRatio(text.slice(0, cnBlock)) > 0.45) return cnBlock;
  return -1;
}

export function looksLikeEnglishReasoningWall(text: string): boolean {
  const t = text.trim();
  if (t.length < 280) return false;
  if (latinRatio(t) < 0.42) return false;
  if (ENGLISH_REASONING_START.test(t)) return true;
  if (/\b(let me|i need to|i understand|the user wants|search for|execute the)\b/i.test(t.slice(0, 400))) {
    return true;
  }
  return false;
}

export function extractTrackedJobIds(text: string): string[] {
  const ids = new Set<string>();
  const lower = text.toLowerCase();
  if (!lower.includes("job")) {
    return [];
  }
  for (const match of text.matchAll(UUID_RE)) {
    const id = match[0];
    const ctx = lower.slice(Math.max(0, match.index! - 24), match.index! + id.length + 8);
    if (ctx.includes("job")) ids.add(id);
  }
  return [...ids];
}

export function hasTerminalJobReport(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (TERMINAL_JOB_STATUS_RE.test(t)) return true;
  const statusHits = (t.match(/\b(success|failed|completed|partial_failed|skipped)\b/gi) ?? []).length;
  const platformHits = (t.match(/抖音|视频号|小红书|B站|快手|bilibili|douyin/gi) ?? []).length;
  return statusHits >= 3 && platformHits >= 2;
}

/** 中间态：已入队/轮询中，尚无终态表。 */
export function isInterimAssistantStatus(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasTerminalJobReport(t)) return false;
  const hasJob = extractTrackedJobIds(t).length > 0;
  if (hasJob && INTERIM_STATUS_RE.test(t)) return true;
  if (hasJob && /pending|进行中|上传中/i.test(t) && !hasTerminalJobReport(t)) return true;
  return false;
}

export function isPlanningOnlyAssistantContent(content: string): boolean {
  const t = content.trim();
  if (!t || t.length > 480) return false;
  if (findDeliverableSectionStart(t) >= 0) return false;
  if (/桌面|路径[:：]|\.(?:md|xlsx|docx|pptx|pdf)\b|【任务/.test(t)) return false;
  return PLANNING_ONLY_RE.test(t);
}

export function isDeliveredAssistantContent(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (/Message failed/i.test(t) || /^\[错误\]/.test(t)) return false;
  if (isPlanningOnlyAssistantContent(t)) return false;
  if (looksLikeEnglishReasoningWall(t) && findDeliverableSectionStart(t) < 0) return false;
  if (isInterimAssistantStatus(t)) return false;
  return true;
}

/** 将泄露在正文中的推理前缀拆到 thinking，保留可交付正文。 */
export function partitionAssistantContent(
  content: string,
  existingThinking?: string,
): { body: string; thinking?: string } {
  const text = content.trim();
  if (!text) {
    return { body: "", thinking: existingThinking?.trim() || undefined };
  }

  const start = findDeliverableSectionStart(text);
  if (start > 0) {
    const prefix = text.slice(0, start).trim();
    const body = text.slice(start).trim();
    const think = [existingThinking?.trim(), prefix].filter(Boolean).join("\n\n").trim();
    return { body, thinking: think || undefined };
  }

  if (looksLikeEnglishReasoningWall(text)) {
    const think = [existingThinking?.trim(), text].filter(Boolean).join("\n\n").trim();
    return { body: "", thinking: think || undefined };
  }

  return { body: text, thinking: existingThinking?.trim() || undefined };
}
