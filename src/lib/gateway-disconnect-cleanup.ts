import { resetChatEventDedupState } from "./openclaw/apply-chat-final-event";
import { useSessionStore } from "../stores/sessionStore";
import { useStepStore } from "../stores/stepStore";

/**
 * 网关断开后的会话清理。
 * @param stopActiveTask `true` 时向网关发 chat.abort 并中止任务；`false` 时仅释放本地等待（保留网关侧任务）。
 */
export function cleanupGatewaySessionState(opts?: { stopActiveTask?: boolean }): void {
  const store = useSessionStore.getState();
  const sessionId = store.sendingSessionId ?? store.activeId;
  const stopActiveTask = opts?.stopActiveTask === true;
  const preserveSendDedup = store.isSending && !stopActiveTask;

  if (sessionId && store.isSending) {
    void store.persistStreamingDraftIfNeeded(sessionId).catch(() => false);
  }

  if (stopActiveTask) {
    store.abortActiveSend("user");
    useStepStore.getState().finalizeStaleRunningSteps();
    useStepStore.getState().clear();
  }

  if (!store.isSending) {
    store.clearStreamingDraftForActive();
    store.clearThinkingDraftForActive();
  }
  if (!preserveSendDedup) {
    resetChatEventDedupState();
  }
}
