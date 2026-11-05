/** WebSocket delta 批量刷新，避免每个 token 触发 React 重渲染。 */
export const STREAM_DRAFT_FLUSH_MS = 64;

const streamDraftPending = new Map<string, string>();
let streamDraftFlushTimer: ReturnType<typeof setTimeout> | null = null;

const thinkingDraftPending = new Map<string, string>();
let thinkingDraftFlushTimer: ReturnType<typeof setTimeout> | null = null;

export type StreamDraftSlice = {
  streamingDraftBySession: Record<string, string>;
  thinkingDraftBySession: Record<string, string>;
};

export type StreamDraftSetter = (
  partial:
    | Partial<StreamDraftSlice>
    | StreamDraftSlice
    | ((state: StreamDraftSlice) => Partial<StreamDraftSlice> | StreamDraftSlice),
) => void;

export function cancelStreamDraftFlushTimer() {
  if (streamDraftFlushTimer != null) {
    clearTimeout(streamDraftFlushTimer);
    streamDraftFlushTimer = null;
  }
}

export function flushStreamingDrafts(set: StreamDraftSetter) {
  cancelStreamDraftFlushTimer();
  if (streamDraftPending.size === 0) return;
  const batch = Object.fromEntries(streamDraftPending);
  streamDraftPending.clear();
  set((s) => ({
    streamingDraftBySession: { ...s.streamingDraftBySession, ...batch },
  }));
}

export function scheduleStreamingDraftFlush(set: StreamDraftSetter) {
  if (streamDraftFlushTimer != null) return;
  streamDraftFlushTimer = setTimeout(() => {
    streamDraftFlushTimer = null;
    flushStreamingDrafts(set);
  }, STREAM_DRAFT_FLUSH_MS);
}

export function queueStreamingDraft(sessionId: string, text: string) {
  streamDraftPending.set(sessionId, text);
}

export function removeStreamingDraftPending(sessionId: string) {
  streamDraftPending.delete(sessionId);
}

export function setStreamingDraftPending(sessionId: string, text: string) {
  streamDraftPending.set(sessionId, text);
}

export function cancelThinkingDraftFlushTimer() {
  if (thinkingDraftFlushTimer != null) {
    clearTimeout(thinkingDraftFlushTimer);
    thinkingDraftFlushTimer = null;
  }
}

export function flushThinkingDrafts(set: StreamDraftSetter) {
  cancelThinkingDraftFlushTimer();
  if (thinkingDraftPending.size === 0) return;
  const batch = Object.fromEntries(thinkingDraftPending);
  thinkingDraftPending.clear();
  set((s) => ({
    thinkingDraftBySession: { ...s.thinkingDraftBySession, ...batch },
  }));
}

export function scheduleThinkingDraftFlush(set: StreamDraftSetter) {
  if (thinkingDraftFlushTimer != null) return;
  thinkingDraftFlushTimer = setTimeout(() => {
    thinkingDraftFlushTimer = null;
    flushThinkingDrafts(set);
  }, STREAM_DRAFT_FLUSH_MS);
}

export function queueThinkingDraft(sessionId: string, text: string) {
  thinkingDraftPending.set(sessionId, text);
}

export function removeThinkingDraftPending(sessionId: string) {
  thinkingDraftPending.delete(sessionId);
}

export function setThinkingDraftPending(sessionId: string, text: string) {
  thinkingDraftPending.set(sessionId, text);
}

export function resetStreamingDraftBuffers() {
  cancelStreamDraftFlushTimer();
  streamDraftPending.clear();
  cancelThinkingDraftFlushTimer();
  thinkingDraftPending.clear();
}

export function getStreamingDraftPendingSnapshot(): Record<string, string> {
  return Object.fromEntries(streamDraftPending);
}

export function getThinkingDraftPendingSnapshot(): Record<string, string> {
  return Object.fromEntries(thinkingDraftPending);
}
