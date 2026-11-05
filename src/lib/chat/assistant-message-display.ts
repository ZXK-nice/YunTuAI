import { stripOfficeWriteFences } from "./office-write-back";
import { partitionAssistantContent } from "./deliverable-content";
import {
  parseMessageDisplayContent,
  type MessageFilesPayload,
  type ParsedDisplayContent,
} from "./message-files";

/** 流式 delta 合并：兼容「全文快照」与「真增量」，避免重复拼接。 */
export function mergeStreamingText(existing: string, piece: string): string {
  const prev = existing;
  const next = piece;
  if (!next.trim()) return prev;
  if (!prev.trim()) return next;
  if (next === prev) return prev;
  if (next.startsWith(prev)) return next;
  if (prev.startsWith(next)) return prev;
  if (prev.includes(next)) return prev;
  if (next.includes(prev)) return next;

  const probeLen = Math.min(96, prev.length);
  if (probeLen >= 48) {
    const probe = prev.slice(0, probeLen);
    const hits = countOccurrences(prev, probe);
    if (hits >= 3 && next.includes(probe)) {
      return next.length >= prev.length ? next : prev;
    }
  }

  if (looksLikeInternalDisplayPayload(prev) || looksLikeInternalDisplayPayload(next)) {
    return next.length >= prev.length ? next : prev;
  }

  return prev + next;
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while (i <= text.length - needle.length) {
    const at = text.indexOf(needle, i);
    if (at < 0) break;
    n += 1;
    i = at + needle.length;
  }
  return n;
}

export function looksLikeInternalDisplayPayload(raw: string): boolean {
  const t = raw.trimStart();
  if (!t.startsWith("{")) return false;
  return /"v"\s*:\s*(1|2)/.test(t.slice(0, 120)) && /"files"\s*:\s*\[/.test(t.slice(0, 400));
}

function tryStrictDisplayJson(raw: string): ParsedDisplayContent | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<MessageFilesPayload>;
    if ((parsed.v === 1 || parsed.v === 2) && Array.isArray(parsed.files)) {
      return parseMessageDisplayContent(trimmed, parsed.text ?? "");
    }
  } catch {
    /* truncated stream */
  }
  return null;
}

function extractLooseJsonStringField(raw: string, field: "text" | "thinking"): string | undefined {
  const re = new RegExp(`"${field}"\\s*:\\s*"`, "s");
  const m = re.exec(raw);
  if (!m || m.index == null) return undefined;
  let i = m.index + m[0].length;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else out += next ?? "";
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i += 1;
  }
  return out.trim() || undefined;
}

/** 从误写入 content 的内部 JSON（含截断流）提取正文与思考。 */
export function tryParseDisplayPayloadJson(raw: string): ParsedDisplayContent | null {
  const strict = tryStrictDisplayJson(raw);
  if (strict) return strict;

  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !looksLikeInternalDisplayPayload(trimmed)) return null;

  const text = extractLooseJsonStringField(trimmed, "text");
  const thinking = extractLooseJsonStringField(trimmed, "thinking");
  if (!text && !thinking) return null;

  return {
    text: collapseStreamRepetition(text ?? ""),
    files: [],
    thinking: thinking ? collapseStreamRepetition(thinking) : undefined,
  };
}

/** 流式重复拼接后的明显垃圾：取最后一次完整用户可见段落。 */
export function collapseStreamRepetition(text: string): string {
  const t = text.trim();
  if (!t) return text;

  for (let len = Math.min(240, Math.floor(t.length / 3)); len >= 48; len -= 1) {
    const chunk = t.slice(0, len);
    if (!chunk.trim()) continue;
    const reps = Math.floor(t.length / len);
    if (reps >= 3 && chunk.repeat(reps) === t.slice(0, chunk.length * reps)) {
      return chunk.trim();
    }
  }

  const markers = [
    "**方案一",
    "【方案一",
    "结果已生成。方案",
    "结果已生成",
    "\n---\n",
  ];
  for (const marker of markers) {
    const count = (t.match(new RegExp(escapeRegExp(marker), "g")) ?? []).length;
    if (count >= 3) {
      const last = t.lastIndexOf(marker);
      if (last >= 0 && last > t.length * 0.25) {
        return t.slice(last).trimStart();
      }
    }
  }

  if (t.length < 1800) return text;

  const head = t.slice(0, Math.min(80, t.length));
  if (head.length >= 40 && countOccurrences(t, head) >= 4) {
    const last = t.lastIndexOf(head);
    if (last > 0) return t.slice(last).trimStart();
  }

  return text;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 气泡展示：display_content + content 双路解析，剥离内部 JSON 与流式重复。 */
export function parseAssistantMessageForBubble(
  displayContent: string | null | undefined,
  content: string,
): ParsedDisplayContent {
  const fromDisplay = parseMessageDisplayContent(displayContent, content);
  let text = collapseStreamRepetition(fromDisplay.text);
  let thinking = fromDisplay.thinking ? collapseStreamRepetition(fromDisplay.thinking) : undefined;

  const leaked =
    tryParseDisplayPayloadJson(text) ??
    (displayContent?.trim() ? null : tryParseDisplayPayloadJson(content));
  if (leaked) {
    if (leaked.text.trim()) text = leaked.text;
    if (leaked.thinking?.trim()) thinking = leaked.thinking;
    if (leaked.files.length > 0 && fromDisplay.files.length === 0) {
      return { text: stripOfficeWriteFences(text), files: leaked.files, thinking };
    }
  }

  if (thinking && text.trim() === thinking.trim()) {
    thinking = undefined;
  }

  const partitioned = partitionAssistantContent(stripOfficeWriteFences(text), thinking);
  return { text: partitioned.body, files: fromDisplay.files, thinking: partitioned.thinking };
}

/** 落库前净化：勿把 v2 JSON 写入 content；思考分流到 thinking。 */
export function sanitizeAssistantPersistContent(
  content: string,
  thinking?: string,
): { content: string; thinking?: string } {
  let body = collapseStreamRepetition(content.trim());
  let think = thinking?.trim() ? collapseStreamRepetition(thinking.trim()) : undefined;

  const leaked = tryParseDisplayPayloadJson(body);
  if (leaked) {
    if (leaked.text.trim()) body = leaked.text.trim();
    if (leaked.thinking?.trim()) {
      think = think ? `${think}\n${leaked.thinking}`.trim() : leaked.thinking.trim();
    }
  }

  if (think && body === think) think = undefined;

  const partitioned = partitionAssistantContent(stripOfficeWriteFences(body), think);
  return {
    content: partitioned.body,
    thinking: partitioned.thinking,
  };
}
