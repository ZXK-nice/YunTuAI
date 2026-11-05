const CODE_FENCE_RE = /(```[\s\S]*?```)/g;

/** 中英文混排、段落空行等微排版（不改动代码块内容）。 */
function beautifyPlainSegment(text: string): string {
  if (!text) return text;
  return (
    text
      // 中文与 ASCII 字母数字之间加细空格，提升可读性（大厂常见做法）
      .replace(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])([A-Za-z0-9])/g, "$1 $2")
      .replace(/([A-Za-z0-9])([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])/g, "$1 $2")
      // 连续空行收敛为一段落间距
      .replace(/\n{3,}/g, "\n\n")
  );
}

/**
 * 对助手/用户可见文本做中文友好微排版。
 * 纯字符串处理，不调用模型，不影响流式首字延迟。
 */
export function beautifyChineseText(text: string): string {
  if (!text.trim()) return text;
  return text
    .split(CODE_FENCE_RE)
    .map((part) => (part.startsWith("```") ? part : beautifyPlainSegment(part)))
    .join("");
}

export type CalloutKind = "tip" | "note" | "warning" | "summary";

const CALLOUT_PATTERNS: { kind: CalloutKind; re: RegExp }[] = [
  { kind: "warning", re: /^(?:⚠️|⚠|【?注意】?|\*\*注意\*\*|\*\*警告\*\*)/ },
  { kind: "tip", re: /^(?:💡|【?提示】?|\*\*提示\*\*|\*\*小贴士\*\*)/ },
  { kind: "summary", re: /^(?:📌|【?总结】?|【?结论】?|\*\*总结\*\*|\*\*结论\*\*)/ },
  { kind: "note", re: /^(?:ℹ️|【?说明】?|\*\*说明\*\*|\*\*备注\*\*)/ },
];

export function detectCalloutKind(line: string): CalloutKind | null {
  const inner = line.replace(/^>\s?/, "").trim();
  for (const { kind, re } of CALLOUT_PATTERNS) {
    if (re.test(inner)) return kind;
  }
  return null;
}
