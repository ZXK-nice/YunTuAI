import type { MessageFileEntry } from "./message-files";
import type { MeetingDigestItem, MeetingLiveState } from "../meeting/meeting-bridge";
import { formatMeetingElapsed, speakerDisplayLabel } from "../meeting/meeting-bridge";
import { buildTaskTemplatePrompt, TASK_TEMPLATES } from "../openclaw/task-templates";

export type MeetingContextCard = {
  kind: "meeting";
  sessionId: string;
  title: string;
  elapsedMs: number;
  digestCount: number;
  segmentCount: number;
  summaryPreview?: string;
  speakers?: string[];
};

export type ImageContextCard = {
  kind: "image";
  path: string;
  prompt: string;
  model?: string;
  size?: string;
};

export type ChatContextCard = MeetingContextCard | ImageContextCard;

export type MessageContextPayload = {
  v: 3;
  text?: string;
  cards: ChatContextCard[];
  files?: MessageFileEntry[];
};

const MEETING_TEMPLATE = TASK_TEMPLATES.find((t) => t.id === "meeting-notes")!;

export function buildMeetingContextCard(live: MeetingLiveState): MeetingContextCard {
  const latestDigest: MeetingDigestItem | undefined = live.digests[live.digests.length - 1];
  const speakers = [...new Set(live.segments.map((s) => speakerDisplayLabel(live.session.speakerAliases, s.speaker)))];
  return {
    kind: "meeting",
    sessionId: live.session.id,
    title: live.session.title,
    elapsedMs: live.elapsedMs,
    digestCount: live.digests.length,
    segmentCount: live.segmentTotal || live.segments.length,
    summaryPreview: latestDigest?.summary?.trim().slice(0, 160) || undefined,
    speakers: speakers.length > 0 ? speakers : undefined,
  };
}

export function buildMeetingChatText(live: MeetingLiveState): string {
  const task = buildTaskTemplatePrompt(MEETING_TEMPLATE);
  const lines: string[] = [
    `【会议转写 · ${live.session.title}】`,
    `时长：${formatMeetingElapsed(live.elapsedMs)} · ${live.digests.length} 阶段整理 · ${live.segmentTotal || live.segments.length} 段转写`,
    "",
  ];
  if (live.digests.length > 0) {
    lines.push("【阶段整理摘要】");
    for (const d of live.digests.slice(-3)) {
      lines.push(`阶段 ${d.periodIndex + 1}：${d.summary.trim().slice(0, 200)}`);
    }
    lines.push("");
  }
  if (live.segments.length > 0) {
    lines.push("【逐字稿节选】");
    const tail = live.segments.slice(-8);
    for (const seg of tail) {
      const label = speakerDisplayLabel(live.session.speakerAliases, seg.speaker);
      lines.push(`[${formatMeetingElapsed(seg.startMs)}] ${label}: ${seg.text}`);
    }
    if ((live.segmentTotal || live.segments.length) > tail.length) {
      lines.push(`… 另有 ${(live.segmentTotal || live.segments.length) - tail.length} 段`);
    }
    lines.push("");
  }
  return `${task}\n\n${lines.join("\n")}`;
}

export function encodeContextMessage(text: string, cards: ChatContextCard[], files: MessageFileEntry[] = []): string {
  const payload: MessageContextPayload = {
    v: 3,
    text: text.trim() || undefined,
    cards,
    files: files.length > 0 ? files : undefined,
  };
  return JSON.stringify(payload);
}

export function parseContextMessage(
  displayContent: string | null | undefined,
  fallbackContent: string,
): { text: string; cards: ChatContextCard[]; files: MessageFileEntry[] } {
  if (!displayContent?.trim()) {
    return { text: fallbackContent, cards: [], files: [] };
  }
  const raw = displayContent.trim();
  if (!raw.startsWith("{")) {
    return { text: raw || fallbackContent, cards: [], files: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MessageContextPayload>;
    if (parsed.v === 3 && Array.isArray(parsed.cards)) {
      const cards = parsed.cards.filter(
        (c): c is ChatContextCard =>
          Boolean(c && (c.kind === "meeting" || c.kind === "image")),
      );
      const files = (parsed.files ?? []).filter(
        (f): f is MessageFileEntry =>
          Boolean(f && typeof f.name === "string" && typeof f.path === "string"),
      );
      return {
        text: (parsed.text ?? fallbackContent).trim() || fallbackContent,
        cards,
        files,
      };
    }
  } catch {
    /* fall through */
  }
  return { text: fallbackContent, cards: [], files: [] };
}

export function isInterruptedAssistantContent(content: string): boolean {
  return content.includes("【生成已中断");
}
