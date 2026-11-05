/**
 * Gateway `chat` / `*.chat` payload.state values.
 * Keep ingest timeline + assistant persistence aligned with what the server may send.
 */

/** Ends a turn for purposes of collapsing stale "running" pipeline steps */
export const CHAT_PIPELINE_CLOSE_STATES = new Set([
  "final",
  "complete",
  "completed",
  "done",
  "ok",
  "error",
  "aborted",
  /** 部分网关/扩展会用下列值表示回合结束，遗漏时会导致任务时间线卡在「进行中」 */
  "stopped",
  "stop",
  "cancelled",
  "canceled",
  "finished",
  "finish",
  "end",
  "ended",
]);

/** Same as a successful `final` for merging deltas and persisting assistant text */
export const CHAT_ASSISTANT_FINAL_LIKE_STATES = new Set([
  "final",
  "complete",
  "completed",
  "done",
  "ok",
  "stopped",
  "stop",
  "cancelled",
  "canceled",
  "finished",
  "finish",
  "end",
  "ended",
]);

function norm(s: unknown): string | null {
  return typeof s === "string" ? s.toLowerCase() : null;
}

export function isChatPipelineCloseState(state: unknown): boolean {
  const n = norm(state);
  return n !== null && CHAT_PIPELINE_CLOSE_STATES.has(n);
}

export function isChatAssistantFinalLikeState(state: unknown): boolean {
  const n = norm(state);
  return n !== null && CHAT_ASSISTANT_FINAL_LIKE_STATES.has(n);
}
