import { isWithinLocalMessageLimit, LOCAL_MESSAGE_TOO_LONG } from "../db-limits";
import { PRODUCT_NAME } from "../product-brand";
import { upsertTurnAssistantMessage } from "../chat/upsert-turn-assistant-message";
import {
  isChatAssistantFinalLikeState,
  isChatPipelineCloseState,
} from "./chat-payload-terminal";
import { extractAssistantTextFromMessage } from "./chat-history-sync";
import { mergeStreamingText, sanitizeAssistantPersistContent, parseAssistantMessageForBubble } from "../chat/assistant-message-display";
import { isDeliveredAssistantContent, partitionAssistantContent } from "../chat/deliverable-content";
import { isCompactionRecoveryError } from "./compaction-recovery";
import { isAgentRunTimeoutError, humanizeGatewayTimeoutError } from "./agent-run-timeout";
import { humanizeContextLimitError, isContextLimitError } from "./context-limit-policy";
import {
  humanizeAssistantRuntimeError,
  isMessagePresentationWarning,
  shouldAbortSendOnGatewayChatError,
  shouldPersistAssistantErrorBubble,
} from "./runtime-error-policy";
import { useStepStore } from "../../stores/stepStore";
import { getActiveSendHandle, touchActiveSendWsEvent, abortActiveSendForGatewayError } from "../../stores/session-send-active";
import { useSessionStore, type LocalMessageRow } from "../../stores/sessionStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import { findLocalSessionByRemoteKey } from "./session-key-match";
import { runQueuedChatEvent, resetChatEventQueues } from "./chat-event-queue";
import { clearMessageFingerprintClaims } from "./chat-message-dedup";

const seenRunIds = new Set<string>();
const seenRunIdOrder: string[] = [];
/** 部分模型/通道以 delta 流式输出，final 里 message 可能为空，需与 delta 合并 */
const deltaTextByRunId = new Map<string, string>();
/** 思考过程 delta 文本（如 DeepSeek reasoning_content），按 runId 累积 */
const thinkingTextByRunId = new Map<string, string>();

const unmatchedSessionKeyToastAt = new Map<string, number>();
const UNMATCHED_SESSION_KEY_TOAST_MS = 60_000;

function sessionKeyMatchesActiveSend(sessionKey: string): boolean {
  const h = getActiveSendHandle();
  if (!h) return false;
  const needle = sessionKey.trim();
  if (!needle) return false;
  return (
    h.sessionKey === needle ||
    h.sessionKey.toLowerCase() === needle.toLowerCase()
  );
}

/** 网关 sessionKey 无法映射到本地会话时提示用户（限流；无害孤儿事件静默忽略）。 */
export function warnUnmatchedSessionKey(sessionKey: string, context: string): void {
  const key = sessionKey.trim();
  if (!key) return;
  // 旧会话/后台任务的收尾：本地已无映射且用户也没在等这条 key → 不打扰
  if (!sessionKeyMatchesActiveSend(key)) return;

  const now = Date.now();
  const last = unmatchedSessionKeyToastAt.get(key) ?? 0;
  if (now - last < UNMATCHED_SESSION_KEY_TOAST_MS) return;
  unmatchedSessionKeyToastAt.set(key, now);
  const hint =
    context === "error"
      ? "办事会话返回了错误，但未能写入当前对话。请点侧栏「刷新会话订阅」或重新打开该会话。"
      : "回复未能写入当前对话。请点侧栏「刷新会话订阅」，或重新打开该会话。";
  useUiStore.getState().showToast(hint, "info");
}

function rememberRunId(runId: string): boolean {
  if (seenRunIds.has(runId)) return false;
  if (seenRunIds.size >= 500) {
    const oldest = seenRunIdOrder.shift();
    if (oldest) seenRunIds.delete(oldest);
  }
  seenRunIds.add(runId);
  seenRunIdOrder.push(runId);
  return true;
}

export function resetChatEventDedupState(): void {
  seenRunIds.clear();
  seenRunIdOrder.length = 0;
  deltaTextByRunId.clear();
  thinkingTextByRunId.clear();
  unmatchedSessionKeyToastAt.clear();
  resetChatEventQueues();
  clearMessageFingerprintClaims();
}

/** 删除会话时清理与该 remote key 相关的 toast 去重状态。 */
export function clearUnmatchedSessionKeyToast(sessionKey?: string | null): void {
  const key = sessionKey?.trim();
  if (!key) return;
  unmatchedSessionKeyToastAt.delete(key);
}

async function appendAssistantLineIfAbsent(
  sessionId: string,
  content: string,
  sinceMs?: number,
  thinking?: string,
): Promise<LocalMessageRow | null> {
  return upsertTurnAssistantMessage(sessionId, content, { sinceMs, thinking });
}

function abortActiveSendForSession(sessionKey: string, errorMessage?: string): void {
  abortActiveSendForGatewayError(sessionKey, errorMessage);
}

function assistantTextFromChatMessage(msg: unknown): string | undefined {
  const direct = extractAssistantTextFromMessage(msg);
  if (direct?.trim()) return direct.trim();
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  if (typeof m.content === "string" && m.content.trim()) return m.content.trim();
  if (Array.isArray(m.content)) {
    const parts: string[] = [];
    for (const block of m.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; text?: unknown };
      if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    }
    return parts.length > 0 ? parts.join("\n").trim() : undefined;
  }
  return undefined;
}

/** 从消息荷载中提取思考/推理内容（如 DeepSeek 的 reasoning_content）。
 *  支持 OpenAI 兼容格式（reasoning_content / thinking）以及嵌套 content 数组。 */
function thinkingTextFromChatMessage(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;

  // OpenAI/DeepSeek 兼容：delta.reasoning_content
  if (typeof m.reasoning_content === "string" && m.reasoning_content.trim()) {
    return m.reasoning_content.trim();
  }
  // 备选字段名：thinking
  if (typeof m.thinking === "string" && m.thinking.trim()) {
    return m.thinking.trim();
  }
  // content 数组中的 thinking 块
  if (Array.isArray(m.content)) {
    const parts: string[] = [];
    for (const block of m.content) {
      if (!block || typeof block !== "object") continue;
      const b = block as { type?: unknown; thinking?: unknown; reasoning_content?: unknown };
      if (b.type === "thinking" || b.type === "reasoning") {
        const t = (typeof b.thinking === "string" && b.thinking) ||
          (typeof b.reasoning_content === "string" && b.reasoning_content);
        if (t) parts.push(t);
      }
    }
    return parts.length > 0 ? parts.join("\n").trim() : undefined;
  }
  return undefined;
}

/** 从聊天事件完整 payload 中提取思考内容（兜底：网关可能把 reasoning_content 放在不同层级）。 */
function thinkingTextFromEventPayload(p: Record<string, unknown>): string | undefined {
  // 优先从 message 里取
  const fromMsg = thinkingTextFromChatMessage(p.message);
  if (fromMsg) return fromMsg;

  // 兜底：payload 顶层
  if (typeof p.reasoning_content === "string" && p.reasoning_content.trim()) {
    return p.reasoning_content.trim();
  }
  if (typeof p.thinking === "string" && p.thinking.trim()) {
    return p.thinking.trim();
  }
  // delta 子对象（某些网关封装格式）
  const delta = p.delta as Record<string, unknown> | undefined;
  if (delta) {
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.trim()) {
      return delta.reasoning_content.trim();
    }
    if (typeof delta.thinking === "string" && delta.thinking.trim()) {
      return delta.thinking.trim();
    }
  }
  return undefined;
}

function findLocalRow(
  sessionKey: string,
  sessions: { id: string; remoteSessionKey: string | null }[],
) {
  return findLocalSessionByRemoteKey(sessionKey, sessions);
}

function hasDeliverableAssistantInCurrentTurn(sessionId: string, sinceMs?: number): boolean {
  const msgs = useSessionStore.getState().messagesBySession[sessionId] ?? [];
  const cutoff = sinceMs != null ? sinceMs - 2_000 : 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m) break;
    const role = m.role.trim().toLowerCase();
    if (role === "user" || role === "human") break;
    if (role !== "assistant" && role !== "model") continue;
    const parsed = parseAssistantMessageForBubble(m.displayContent, m.content);
    const combined = [parsed.text, m.content].map((s) => s?.trim()).filter(Boolean).join("\n\n");
    if (combined && isDeliveredAssistantContent(combined)) return true;
    if (Date.parse(m.createdAt) < cutoff) break;
  }
  const { body } = useSessionStore.getState().getStreamingDraftSnapshot(sessionId);
  const draft = body.trim();
  if (draft.length >= 120) return true;
  if (draft.length >= 48 && isDeliveredAssistantContent(draft)) return true;
  return false;
}

function readStopReason(p: Record<string, unknown>): string | undefined {
  const raw = p.stopReason ?? p.stop_reason;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** @internal 供测试：final 事件是否可能在工具链中途结束 */
export function isLikelyIncompleteAssistantFinal(p: Record<string, unknown>, body: string): boolean {
  const stop = readStopReason(p);
  if (stop === "toolUse") return true;
  if (p.replayInvalid === true) return true;
  return Boolean(body.trim()) && !isDeliveredAssistantContent(body);
}

async function persistStreamingDraftBeforeAbort(sessionKey: string): Promise<void> {
  const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
  if (!local) return;
  const sinceMs = getActiveSendHandle()?.sendStartedAtMs;
  await useSessionStore
    .getState()
    .persistStreamingDraftIfNeeded(local.id, sinceMs)
    .catch(() => false);
}

/**
 * 处理 Gateway 广播的 `chat` 事件（`delta` / `final` / `error` / `aborted`）。
 */
export async function applyGatewayChatEvent(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const p = payload as Record<string, unknown>;
  const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";
  if (!sessionKey) {
    await applyGatewayChatEventInner(payload);
    return;
  }
  await runQueuedChatEvent(sessionKey, () => applyGatewayChatEventInner(payload));
}

async function applyGatewayChatEventInner(payload: unknown): Promise<void> {
  if (!payload || typeof payload !== "object") return;
  const p = payload as Record<string, unknown>;
  const runId = typeof p.runId === "string" ? p.runId : "";
  const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey.trim() : "";

  // 任何为该 session 的 WS 事件都说明后端仍在工作，刷新空闲超时
  if (sessionKey) touchActiveSendWsEvent(sessionKey);

  if (p.state === "delta" && runId) {
    // 思考/推理内容（DeepSeek reasoning_content 等），与正文分流
    const thinkingPiece = thinkingTextFromEventPayload(p);
    if (thinkingPiece) {
      const existing = thinkingTextByRunId.get(runId) ?? "";
      // 有些后端在 delta 中发送的是全文而非增量，若新文本以已有文本开头则应替换而非追加
      const mergedThinking = mergeStreamingText(existing, thinkingPiece);
      thinkingTextByRunId.set(runId, mergedThinking);
      if (sessionKey) {
        const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
        if (local) {
          useSessionStore.getState().setThinkingDraft(local.id, mergedThinking);
        }
      }
    }

    const piece = assistantTextFromChatMessage(p.message);
    if (piece) {
      const existing = deltaTextByRunId.get(runId) ?? "";
      // 有些后端在 delta 中发送的是全文而非增量，若新文本以已有文本开头则应替换而非追加
      const merged = mergeStreamingText(existing, piece);
      deltaTextByRunId.set(runId, merged);
      if (sessionKey) {
        const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
        if (local) {
          useSessionStore.getState().setStreamingDraft(local.id, merged);
        }
      }
    }
    if (deltaTextByRunId.size > 200) {
      const first = deltaTextByRunId.keys().next().value as string | undefined;
      if (first) deltaTextByRunId.delete(first);
    }
    if (thinkingTextByRunId.size > 200) {
      const first = thinkingTextByRunId.keys().next().value as string | undefined;
      if (first) thinkingTextByRunId.delete(first);
    }
    return;
  }

  if (p.state === "aborted" || p.state === "error") {
    const errMsg =
      typeof p.errorMessage === "string" && p.errorMessage.trim()
        ? p.errorMessage.trim()
        : "";
    const compactionErr = isCompactionRecoveryError(errMsg);
    let hasDeliverable = false;
    if (sessionKey) {
      const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
      if (local) {
        hasDeliverable = hasDeliverableAssistantInCurrentTurn(
          local.id,
          getActiveSendHandle()?.sendStartedAtMs,
        );
      }
    }
    const shouldAbort =
      !compactionErr &&
      shouldAbortSendOnGatewayChatError(errMsg, { hasDeliverableInTurn: hasDeliverable });
    if (runId && shouldAbort) {
      deltaTextByRunId.delete(runId);
      thinkingTextByRunId.delete(runId);
    }
    if (sessionKey && shouldAbort) {
      await persistStreamingDraftBeforeAbort(sessionKey);
      const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
      if (local) {
        useSessionStore.getState().clearStreamingDraft(local.id);
        useSessionStore.getState().clearThinkingDraft(local.id);
      }
      abortActiveSendForSession(sessionKey, errMsg);
    }
  }

  if (p.state === "error") {
    const errMsg =
      typeof p.errorMessage === "string" && p.errorMessage.trim()
        ? p.errorMessage.trim()
        : "";
    if (errMsg && isMessagePresentationWarning(errMsg) && sessionKey) {
      const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
      const sinceMs = getActiveSendHandle()?.sendStartedAtMs;
      if (local && hasDeliverableAssistantInCurrentTurn(local.id, sinceMs)) {
        return;
      }
    }
    if (errMsg && isContextLimitError(errMsg)) {
      useUiStore.getState().showToast(humanizeContextLimitError(errMsg), "warning");
      if (isCompactionRecoveryError(errMsg)) return;
    }
    const err = errMsg || `${PRODUCT_NAME} 运行出错`;
    if (!sessionKey) return;
    const local = findLocalRow(sessionKey, useSessionStore.getState().sessions);
    if (!local) {
      warnUnmatchedSessionKey(sessionKey, "error");
      return;
    }
    const sendActive = Boolean(
      getActiveSendHandle()?.sessionKey &&
        getActiveSendHandle()!.sessionKey.trim().toLowerCase() === sessionKey.trim().toLowerCase(),
    );
    if (isAgentRunTimeoutError(err) && sendActive) {
      useUiStore.getState().showToast(humanizeGatewayTimeoutError(err), "warning");
      useStepStore.getState().finalizeStaleRunningSteps("skipped");
      return;
    }
    if (
      !shouldPersistAssistantErrorBubble(err, {
        sendStillActive: sendActive,
        hasDeliverableInTurn: hasDeliverableAssistantInCurrentTurn(
          local.id,
          getActiveSendHandle()?.sendStartedAtMs,
        ),
      })
    ) {
      // 可自愈工具错误：保持等待，勿把步骤误标为全部成功
      return;
    }
    useStepStore.getState().finalizeStaleRunningSteps("skipped");
    const friendly = humanizeAssistantRuntimeError(err);
    const line = `[错误] ${isContextLimitError(err) ? humanizeContextLimitError(err) : friendly}`;
    if (!isWithinLocalMessageLimit(line)) {
      useGatewayStore.setState({ lastError: LOCAL_MESSAGE_TOO_LONG });
      return;
    }
    await appendAssistantLineIfAbsent(local.id, line);
    return;
  }

  if (p.state === "aborted") {
    const errMsg =
      typeof p.errorMessage === "string" && p.errorMessage.trim()
        ? p.errorMessage.trim()
        : "";
    // 可自愈工具失败偶发 aborted 态：勿收口等待、勿误标成功
    if (!shouldAbortSendOnGatewayChatError(errMsg)) return;
    useStepStore.getState().finalizeStaleRunningSteps("skipped");
    return;
  }

  /**
   * 必须先于 `isChatAssistantFinalLikeState` 判断：终态若不在「可写正文」白名单内，原先会直接 return，
   * 导致 `finalizeStaleRunningSteps` 从未执行，界面残留「任务流进行中」。
   * error / aborted 已在上方处理；此处覆盖其余 pipeline 关闭态（含 stopped、idle 等）。
   */
  if (isChatPipelineCloseState(p.state)) {
    useStepStore.getState().finalizeStaleRunningSteps();
  }

  if (!isChatAssistantFinalLikeState(p.state)) return;

  if (!sessionKey) return;

  // 快照 delta 文本（后续会被 consume/delete）
  const deltaSnapshot = runId ? (deltaTextByRunId.get(runId) ?? "").trim() : "";

  let text = assistantTextFromChatMessage(p.message);
  if ((!text || !text.trim()) && runId) {
    const merged = deltaTextByRunId.get(runId);
    if (runId) deltaTextByRunId.delete(runId);
    text = merged?.trim();
  } else if (runId) {
    deltaTextByRunId.delete(runId);
  }

  // 收集思考内容（来自 delta 累积或 final message 中的思考字段）
  let thinking: string | undefined;
  if (runId) {
    thinking = thinkingTextByRunId.get(runId);
    thinkingTextByRunId.delete(runId);
  }
  if (!thinking?.trim()) {
    thinking = thinkingTextFromEventPayload(p);
  }
  // 兜底：无 reasoning_content 时，把流式 delta 累积文本作为思考过程保存
  // 避免与主文本重复（某些后端在 final 中不返回 reasoning_content，deltaSnapshot 与 text 相同）
  if (!thinking?.trim() && deltaSnapshot && deltaSnapshot !== text?.trim()) {
    thinking = deltaSnapshot;
  }

  if (!text?.trim()) {
    const sessions = useSessionStore.getState().sessions;
    const local = findLocalRow(sessionKey, sessions);
    if (local) {
      useSessionStore.getState().flushStreamingDraftsNow();
      const draft = useSessionStore.getState().getStreamingDraftSnapshot(local.id);
      if (draft.body) {
        text = draft.body;
        if (!thinking?.trim() && draft.thinking) {
          thinking = draft.thinking;
        }
      }
    }
    if (!text?.trim()) {
      // 空 final（工具中途帧 / 仅工具产出）不能当 ws_complete，否则 loading 提前结束且无回复
      return;
    }
  }

  if (runId) {
    if (!rememberRunId(runId)) return;
  }

  const sessions = useSessionStore.getState().sessions;
  const local = findLocalRow(sessionKey, sessions);
  if (!local) {
    warnUnmatchedSessionKey(sessionKey, "final");
    return;
  }

  useSessionStore.getState().clearStreamingDraft(local.id);
  useSessionStore.getState().clearThinkingDraft(local.id);

  if (!isWithinLocalMessageLimit(text)) {
    useGatewayStore.setState({ lastError: LOCAL_MESSAGE_TOO_LONG });
    return;
  }

  const sanitized = sanitizeAssistantPersistContent(text, thinking?.trim());
  const partitioned = partitionAssistantContent(sanitized.content, sanitized.thinking);
  text = partitioned.body;
  thinking = partitioned.thinking;

  const sinceMs = getActiveSendHandle()?.sendStartedAtMs;
  if (text.trim() || thinking?.trim()) {
    await appendAssistantLineIfAbsent(local.id, text, sinceMs, thinking?.trim());
  }
  void useSessionStore.getState().tryAutoTitleSession(local.id);

  if (sessionKey) {
    useSessionStore.getState().finishActiveSendFromWebSocket(sessionKey);
  }
  // 交付收尾由 sendMessage 的 ws_complete / aborted 路径统一负责，避免双 finalize 重复建任务
}
