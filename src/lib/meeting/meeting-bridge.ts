import { invokeWithAuthRetry } from "../auth-token";
import { isTauriRuntime } from "../tauri-env";

export type MeetingSegmentItem = {
  id: string;
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
};

export type MeetingDigestItem = {
  id: string;
  periodIndex: number;
  startMs: number;
  endMs: number;
  summary: string;
  actionItems: string[];
  decisions: string[];
  openQuestions: string[];
  createdAt: string;
};

export type MeetingSessionItem = {
  id: string;
  title: string;
  status: string;
  startedAtMs: number;
  endedAtMs?: number | null;
  audioPath?: string | null;
  digestCount: number;
  speakerAliases: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type MeetingLiveState = {
  session: MeetingSessionItem;
  segments: MeetingSegmentItem[];
  digests: MeetingDigestItem[];
  recording: boolean;
  elapsedMs: number;
  segmentTotal: number;
  hasMoreSegments: boolean;
};

export type MeetingSegmentsPage = {
  segments: MeetingSegmentItem[];
  total: number;
  hasMore: boolean;
};

export type MeetingDigestEvent = {
  sessionId: string;
  digest: MeetingDigestItem;
};

const MEETING_TIMEOUT_MS = 30_000;
const MEETING_DIGEST_TIMEOUT_MS = 150_000;
const SEGMENT_TAIL = 200;

async function invokeMeeting<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  timeoutMs = MEETING_TIMEOUT_MS,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("该能力仅在桌面客户端中使用");
  }
  return invokeWithAuthRetry<T>(cmd, args, { timeoutMs, critical: true });
}

export async function createMeetingSession(title?: string): Promise<MeetingSessionItem> {
  return invokeMeeting("meeting_create_session", { title: title?.trim() || null });
}

export async function listMeetingSessions(): Promise<MeetingSessionItem[]> {
  return invokeMeeting("meeting_list_sessions");
}

export async function getMeetingLiveState(
  sessionId: string,
  segmentTail = SEGMENT_TAIL,
): Promise<MeetingLiveState> {
  return invokeMeeting("meeting_get_live_state", { sessionId, segmentTail });
}

export async function loadOlderMeetingSegments(
  sessionId: string,
  beforeStartMs: number,
): Promise<MeetingSegmentsPage> {
  return invokeMeeting("meeting_load_older_segments", {
    sessionId,
    beforeStartMs,
    limit: SEGMENT_TAIL,
  });
}

export async function startMeetingRecording(sessionId: string): Promise<MeetingLiveState> {
  return invokeMeeting("meeting_start_recording", { sessionId });
}

export async function pushMeetingSegment(input: {
  sessionId: string;
  text: string;
  startMs: number;
  endMs: number;
  rms?: number;
}): Promise<MeetingSegmentItem> {
  return invokeMeeting("meeting_push_segment", {
    sessionId: input.sessionId,
    text: input.text,
    startMs: input.startMs,
    endMs: input.endMs,
    rms: input.rms,
  });
}

export async function pushMeetingAudioChunk(sessionId: string, chunkBase64: string): Promise<void> {
  return invokeMeeting("meeting_push_audio_chunk", { sessionId, chunkBase64 }, 60_000);
}

export async function stopMeetingRecording(sessionId: string): Promise<MeetingLiveState> {
  return invokeMeeting("meeting_stop_recording", { sessionId }, MEETING_DIGEST_TIMEOUT_MS);
}

export async function triggerMeetingDigest(sessionId: string): Promise<MeetingLiveState> {
  return invokeMeeting("meeting_trigger_digest", { sessionId }, MEETING_DIGEST_TIMEOUT_MS);
}

export async function updateMeetingSession(input: {
  sessionId: string;
  title?: string;
  speakerAliases?: Record<string, string>;
}): Promise<MeetingSessionItem> {
  return invokeMeeting("meeting_update_session", {
    sessionId: input.sessionId,
    title: input.title ?? null,
    speakerAliases: input.speakerAliases ?? null,
  });
}

export async function updateMeetingSegment(input: {
  sessionId: string;
  segmentId: string;
  text: string;
}): Promise<MeetingSegmentItem> {
  return invokeMeeting("meeting_update_segment", {
    sessionId: input.sessionId,
    segmentId: input.segmentId,
    text: input.text,
  });
}

export async function importMeetingAudio(sessionId: string): Promise<string> {
  return invokeMeeting("meeting_import_audio", { sessionId }, 60_000);
}

export async function transcribeMeetingLiveChunk(
  sessionId: string,
  wavBase64: string,
): Promise<string> {
  return invokeMeeting<string>(
    "meeting_transcribe_live_chunk",
    { sessionId, wavBase64 },
    45_000,
  );
}

export async function transcribeMeetingAudio(sessionId: string): Promise<MeetingLiveState> {
  const result = await invokeMeeting<{ segmentCount: number; live: MeetingLiveState }>(
    "meeting_transcribe_audio",
    { sessionId },
    600_000,
  );
  return result.live;
}

export async function deleteMeetingSession(sessionId: string): Promise<void> {
  return invokeMeeting("meeting_delete_session", { sessionId });
}

export async function exportMeetingDocx(
  sessionId: string,
  speaker?: "A" | "B" | "C" | null,
): Promise<string> {
  return invokeMeeting(
    "meeting_export_docx",
    { sessionId, speaker: speaker ?? null },
    60_000,
  );
}

export function collectMeetingSpeakers(segments: MeetingSegmentItem[]): Array<"A" | "B" | "C"> {
  const order: Array<"A" | "B" | "C"> = ["A", "B", "C"];
  const seen = new Set(segments.map((s) => s.speaker.toUpperCase()));
  return order.filter((sp) => seen.has(sp));
}

export function speakerDisplayLabel(
  aliases: Record<string, string> | undefined,
  speaker: string,
): string {
  const alias = aliases?.[speaker]?.trim();
  return alias || speaker;
}

export function formatMeetingElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function meetingStatusLabel(status: string): string {
  switch (status) {
    case "recording":
      return "录制中";
    case "interrupted":
      return "意外中断";
    default:
      return "已结束";
  }
}

export const SPEAKER_COLORS: Record<string, string> = {
  A: "var(--brand-color)",
  B: "#34c759",
  C: "#ff9500",
};
