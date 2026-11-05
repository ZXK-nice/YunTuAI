import { create } from "zustand";
import { isWithinLocalMessageLimit, LOCAL_MESSAGE_TOO_LONG } from "../lib/db-limits";
import { TRUNCATE_ERROR_LONG, TRUNCATE_TOAST } from "../lib/constants";
import { isTauriRuntime } from "../lib/tauri-env";
import { invokeWithAuthRetry } from "../lib/tauri-invoke";
import { humanizeIpcFailure, isIpcTimeoutError, sleep } from "../lib/async-utils";
import {
  ASSISTANT_REPLY_TIMEOUT_NOTICE,
  ASSISTANT_STOPPED_NOTICE,
} from "../lib/openclaw/send-wait";
import {
  baselineFromHistory,
  fetchAssistantErrorAfterSend,
} from "../lib/openclaw/chat-history-sync";
import type { SessionsSendAttachment } from "../lib/openclaw/session-rpc";
import { buildYuntuaiSendMetadata } from "../lib/openclaw/gateway-event-schema";
import { prepareSendKernel } from "./session-send-kernel";
import { resolveDefaultAgentId } from "../lib/openclaw/resolve-default-agent";
import {
  OPENCLAW_STAGING_USER_FILENAME,
  assertMergedUserMdWithinLimit,
  buildUserMdStagingSection,
  extractAgentsFilesGetContent,
  prependStagingToUserMd,
} from "../lib/openclaw/openclaw-user-md-staging";
import {
  clearTaskDeliverySummary,
  finalizeTaskDelivery,
} from "../lib/openclaw/task-delivery";
import { resetChatEventDedupState } from "../lib/openclaw/apply-chat-final-event";
import { withYunTuAiIdentityHint } from "../lib/yuntuai/identity-hint";
import { finalizeGatewaySendSuccess, collectRecentAssistantTextForDelivery } from "./session-send-outcome";
import {
  beginActiveSendSettlement,
  clearActiveSendHandle,
  clearActiveSendState,
  consumeActiveSendFinishReason,
  consumeLastGatewayAbortError,
  getActiveSendHandle,
  markActiveSendDisconnectAbort,
  markActiveSendUserAbort,
  markActiveSendWsComplete,
  resetActiveSendFinishReason,
  setActiveSendHandle,
  endActiveSendSettlement,
} from "./session-send-active";
export {
  abortActiveSendForGatewayError,
  awaitActiveSendSettlement,
  consumeActiveSendFinishReason,
  getActiveSendHandle,
  touchActiveSendWsEvent,
} from "./session-send-active";
import { useStepStore } from "./stepStore";
import { useUiStore } from "./uiStore";
import { useAuthStore } from "./authStore";
import type { SessionMessagesSubscribeResult } from "../lib/openclaw/session-subscribe";
import {
  pickCanonicalRemoteKey,
  resolveSubscriptionHealth,
  shouldPersistCanonicalKey,
} from "./session-subscription-orchestration";
import {
  ensureSessionsMessagesSubscribed,
  ensureSessionsMessagesSubscribedForSend,
  invalidateSessionSubscription,
} from "../lib/openclaw/session-subscribe";
import { getGatewayClient } from "../lib/openclaw/gateway-runtime";
import {
  patchSessionImageModelForVision,
} from "../lib/openclaw/session-model";
import { resolveSelectionToModelId } from "../lib/models/catalog";
import { useModelStore } from "./modelStore";
import { useAgentStore } from "./agentStore";
import { resolveModelSelectionForSend } from "../lib/yuntuai/kb-assistant-send-policy";
import { tryCompactionRecoveryForSession } from "../lib/openclaw/compaction-recovery";
import {
  isModelIdleTimeoutError,
  SEND_ABORT_DISCONNECT_BANNER,
  SEND_ABORT_GATEWAY_ERROR_BANNER,
  ASSISTANT_RUN_TIMEOUT_NOTICE,
  ASSISTANT_MODEL_IDLE_TIMEOUT_NOTICE,
} from "../lib/openclaw/agent-run-timeout";
import { humanizeAssistantRuntimeError } from "../lib/openclaw/runtime-error-policy";
import {
  clearPendingSendRecovery,
  registerPendingSendRecovery,
} from "../lib/openclaw/send-recovery";
import {
  buildSessionHandoffSummary,
} from "../lib/openclaw/task-orchestration";
import { generateLlmHandoffSummary } from "../lib/openclaw/handoff-summary";
import { isLlmHandoffSummaryEnabled } from "../lib/handoff-prefs";
import {
  prepareGatewaySend,
  waitForGatewaySendReply,
} from "./session-send-gateway";
import { dispatchGatewayChatSend } from "../lib/openclaw/session-native-send";
import { SEND_PROGRESS } from "../lib/chat/send-progress";
import { requestDesktopConnect } from "../lib/openclaw/desktop-connect-scheduler";
import {
  appendMessageToSessionMap,
  patchLastUserSendStatusInMap,
} from "./session-messages-projection";
import {
  clearQueuedDisconnectedSend,
  enqueueDisconnectedSend,
  takeQueuedDisconnectedSend,
} from "./session-send-queue";
import { syncSessionMessagesFromGateway } from "../lib/openclaw/session-gateway-sync";
import { handleGatewaySendCatch } from "./session-send-retry";
import { gatewayCreateRemoteSession, useGatewayStore } from "./gatewayStore";
import { extendStepIngestGrace, getLastAnyWsEventMs } from "../lib/openclaw/gateway-shared-state";
import { backfillSessionHistoryFromGateway } from "../lib/openclaw/session-history-backfill";
import { appendUserMessageWithFiles } from "../lib/chat/append-message-with-files";
import {
  compactSupersededAssistantMessagesInDb,
  upsertTurnAssistantMessage,
} from "../lib/chat/upsert-turn-assistant-message";
import { scheduleIncompleteTurnContinue, shouldScheduleIncompleteTurnContinue } from "../lib/openclaw/incomplete-turn-continue";
import type { MessageFileEntry } from "../lib/chat/message-files";
import { encodeMessageDisplayContent, parseMessageDisplayContent } from "../lib/chat/message-files";
import {
  deriveSessionTitle,
  isTitleableAssistantMessage,
  shouldAutoTitleSession,
} from "../lib/chat/session-auto-title";
import { sortSessionsByActivity } from "../lib/chat/session-sort";
import {
  persistStreamingDraftIfNeeded as persistStreamingDraftToDb,
} from "../lib/chat/persist-streaming-draft";
import { shouldOfferSendRetryAfterAbort, collectLastAssistantTextSinceLastUser } from "../lib/chat/send-abort-ux";
import {
  MESSAGE_LOAD_LIMIT,
  MESSAGES_CACHE_MAX,
  messagesLoadGen,
  messagesCacheOrder,
  appendStoppedNoticeInFlight,
  backfillPromises,
  touchMessageCache,
  pruneMessagesCache,
} from "./session-store-message-cache";
import {
  flushStreamingDrafts,
  flushThinkingDrafts,
  scheduleStreamingDraftFlush,
  scheduleThinkingDraftFlush,
  resetStreamingDraftBuffers,
  removeStreamingDraftPending,
  setStreamingDraftPending,
  removeThinkingDraftPending,
  setThinkingDraftPending,
  getStreamingDraftPendingSnapshot,
  getThinkingDraftPendingSnapshot,
} from "./session-store-streaming";

/** subscribed:false 横幅按会话节流，避免每条消息都吞掉。 */
const weakSubscriptionBannerAt = new Map<string, number>();
const WEAK_SUBSCRIPTION_BANNER_MS = 60_000;
const LAST_ACTIVE_SESSION_KEY = "yuntuai.lastActiveSessionId";

function persistLastActiveSessionId(sessionId: string | null): void {
  try {
    if (sessionId) localStorage.setItem(LAST_ACTIVE_SESSION_KEY, sessionId);
    else localStorage.removeItem(LAST_ACTIVE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 鍚姩鍚庢仮澶嶄笂娆＄晫闈細涓婃閫変腑鐨勪細璇濓紝鎴栥€屾柊瀵硅瘽銆峜ompose 鎬侊紙鍕胯寮€鏃т細璇濓級銆?*/
export function restoreLastActiveSessionAfterLoad(): void {
  const store = useSessionStore.getState();
  if (store.activeId) {
    persistLastActiveSessionId(store.activeId);
    return;
  }
  let lastId: string | null = null;
  try {
    lastId = localStorage.getItem(LAST_ACTIVE_SESSION_KEY);
  } catch {
    lastId = null;
  }
  if (lastId && store.sessions.some((s) => s.id === lastId)) {
    store.selectSession(lastId);
    return;
  }
  // 涓婃涓恒€屾柊瀵硅瘽銆嶏細淇濇寔 compose锛屼笉瑕佽嚜鍔ㄦ墦寮€鍒楄〃閲屾煇鏉℃棫浼氳瘽
  if (!lastId) {
    store.enterComposeMode();
    return;
  }
  const latest = sortSessionsByActivity(store.sessions)[0];
  if (latest) {
    store.enterComposeMode();
    return;
  }
  store.enterComposeMode();
}

function noteWeakSubscription(sessionId: string): void {
  const now = Date.now();
  const last = weakSubscriptionBannerAt.get(sessionId) ?? 0;
  if (now - last < WEAK_SUBSCRIPTION_BANNER_MS) return;
  weakSubscriptionBannerAt.set(sessionId, now);
  useUiStore.getState().showToast(
    "当前会话推送订阅偏弱，任务进度可能延迟。可在侧栏点「刷新会话订阅」；多数情况下仍可正常办事。",
    "info",
  );
}

/** 供 `applyGatewayChatEvent` 获取当前活跃轮次信息，用于 WebSocket 最终回复到达后加速结束。 */
export type {
  LocalMessageRow,
  LocalSessionRow,
  MessageListPage,
  RetryableSend,
  SendMessageInput,
  SendMessageWorkspaceFile,
  SessionSubscriptionHealth,
} from "./session-store-types";
import type {
  LocalMessageRow,
  LocalSessionRow,
  MessageListPage,
  RetryableSend,
  SendMessageInput,
  SendMessageWorkspaceFile,
  SessionSubscriptionHealth,
} from "./session-store-types";

function guardLocalAppend(content: string): boolean {
  if (isWithinLocalMessageLimit(content)) return true;
  useUiStore.getState().showToast(LOCAL_MESSAGE_TOO_LONG, "warning");
  return false;
}

type SessionState = {
  sessions: LocalSessionRow[];
  activeId: string | null;
  sessionsLoading: boolean;
  messagesBySession: Record<string, LocalMessageRow[]>;
  hasMoreBySession: Record<string, boolean>;
  loadingOlderBySession: Record<string, boolean>;
  /** 是否正处于「发消息 + 等回复」轮次中（包含 abort 的收尾）。用于驱动 UI 的 loading/typing dots。 */
  isSending: boolean;
  /** 断线时已排队、连上后自动发出 */
  queuedSendPending: boolean;
  flushQueuedSendAfterReconnect: () => Promise<void>;
  /** 褰撳墠鍙戦€佽疆娆＄粦瀹氱殑鏈満浼氳瘽 id锛岄伩鍏嶅垏鎹細璇濆悗璇樉绀烘祦寮忔皵娉?*/
  sendingSessionId: string | null;
  /** 鍙戦€侀摼璺綋鍓嶉樁娈垫枃妗堬紙闄勪欢棰勫鐞?/ 缁戜細璇?/ 鎵ц绛夛級 */
  sendProgressLabel: string | null;
  setSendProgress: (label: string | null) => void;
  /** 会话消息加载中标记，用于展示骨架屏 */
  loadingMessagesBySession: Record<string, boolean>;
  /** 姝ｅ湪浠?Gateway chat.history 鍥炲～鍘嗗彶 */
  syncingHistoryBySession: Record<string, boolean>;
  /** WebSocket delta 流式草稿，按本机会话 id 索引；final 落库后清除。 */
  streamingDraftBySession: Record<string, string>;
  /** 思考过程流式草稿（如 DeepSeek reasoning_content），独立于正文流式输出。 */
  thinkingDraftBySession: Record<string, string>;
  /** 鍚勪細璇濈綉鍏宠闃?鎺ㄩ€佺姸鎬侊紙渚ф爮鍦嗙偣锛?*/
  subscriptionHealthBySession: Record<string, SessionSubscriptionHealth>;
  /** 最近一次发送失败、可一键重试的载荷（用户消息已落库时 skipUserAppend） */
  lastRetryableSend: RetryableSend | null;
  setStreamingDraft: (sessionId: string, text: string) => void;
  clearStreamingDraft: (sessionId: string) => void;
  clearStreamingDraftForActive: () => void;
  setThinkingDraft: (sessionId: string, text: string) => void;
  clearThinkingDraft: (sessionId: string) => void;
  clearThinkingDraftForActive: () => void;
  /** 灏嗗緟鍒锋柊鐨勬祦寮忚崏绋跨珛鍗冲啓鍏?store锛堣鍙栧墠璋冪敤锛夈€?*/
  flushStreamingDraftsNow: () => void;
  /** 璇诲彇浼氳瘽褰撳墠娴佸紡鑽夌锛堝惈灏氭湭 flush 鐨?pending锛夈€?*/
  getStreamingDraftSnapshot: (sessionId: string) => { body: string; thinking: string };
  /** 闀夸换鍔′腑鏂椂锛屽皢娴佸紡鑽夌钀藉簱锛岄伩鍏嶅凡鏄剧ず鍐呭涓㈠け銆?*/
  persistStreamingDraftIfNeeded: (sessionId: string, sinceMs?: number) => Promise<boolean>;
  /** 重连后为本机全部已同步会话重新 subscribe */
  resubscribeAllRemoteSessions: (opts?: { background?: boolean }) => Promise<void>;
  /** 鍒锋柊鍗曚細璇濈綉鍏宠闃咃紙涓嶉噸寤?remote key锛?*/
  refreshSessionSubscription: (sessionId: string) => Promise<void>;
  subscribingSessionId: string | null;
  /** 网关断开后将会话订阅状态降级为 push_weak */
  markSubscriptionsDisconnected: () => void;
  dismissRetryableSend: () => void;
  retryLastSend: () => Promise<void>;
  /** 娑堟伅鍐欏叆鍚庡埛鏂颁晶鏍忔帓搴忎笌鏃堕棿锛堜笌 DB updated_at 瀵归綈锛夈€?*/
  touchSessionActivity: (sessionId: string, updatedAt?: string) => void;
  loadSessions: () => Promise<void>;
  /** 进入「新对话」界面：不选中侧栏会话，也不写入数据库。 */
  enterComposeMode: () => void;
  createSession: (agentId?: string) => Promise<void>;
  /** 更新本机会话标题（仅本地库；网关侧 label 在创建时已是唯一，无需同步）。 */
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  selectSession: (id: string) => void;
  loadMessages: (sessionId: string) => Promise<void>;
  /** 浠?Gateway chat.history 鍥炲～鏈湴缂哄け娑堟伅锛涜繑鍥炶拷鍔犳潯鏁般€?*/
  backfillHistoryFromGateway: (
    sessionId: string,
    opts?: { reload?: boolean; silent?: boolean },
  ) => Promise<number>;
  loadOlderMessages: (sessionId: string) => Promise<void>;
  appendLocalMessage: (sessionId: string, row: LocalMessageRow) => void;
  /** 删除当前会话在本地库中的全部消息，保留会话与远程 key。 */
  clearSessionMessages: (sessionId: string) => Promise<void>;
  /** 删除单条本地消息（仅从本机 SQLite 移除，不改动网关远端历史）。 */
  deleteMessage: (sessionId: string, messageId: string) => Promise<void>;
  sendMessage: (input: SendMessageInput, opts?: {
    skipUserAppend?: boolean;
    autoRetryAttempt?: number;
    compactionRetryAttempt?: number;
    idleRetryAttempt?: number;
    templateId?: string;
    taskTitle?: string;
    /** 浠呮湰鏈烘墽琛岋細绂佹鑱旂綉/澶栧彂宸ュ叿 */
    localOnlyMode?: boolean;
  }) => Promise<void>;
  /** 向网关发 `chat.abort` 并中止本地等回复；无进行中的轮次时为空操作。 */
  abortActiveSend: (reason?: "user" | "disconnect") => void;
  /** 浠呯粨鏉熸湰鍦扮瓑寰呰疆娆★紝涓嶅悜缃戝叧鍙?chat.abort锛堟剰澶栨柇绾挎椂淇濈暀鍚庡彴浠诲姟锛夈€?*/
  releaseActiveSendWaitOnly: () => void;
  /** 鎽樿褰撳墠瀵硅瘽骞舵柊寤轰細璇濈户缁紙鍘嬬缉 + 鎼哄甫鎽樿棣栨潯娑堟伅锛夈€?*/
  summarizeAndContinueInNewChat: () => Promise<void>;
  syncRemoteForActive: () => Promise<boolean>;
  /** 将已有会话关联到一个 Agent（本地数据库迁移）。 */
  setSessionAgent: (sessionId: string, agentId: string | null) => Promise<void>;
  /** 首轮对话结束后，将默认标题替换为简短摘要。 */
  tryAutoTitleSession: (sessionId: string) => Promise<void>;
  /** 登出 / 自动锁屏时清空内存中的会话缓存 */
  resetForLogout: () => void;
  /** WebSocket 已落库最终回复：立即结束 loading，不必等 sessions.send RPC 返回。 */
  finishActiveSendFromWebSocket: (sessionKey: string) => void;
};

function nextDefaultSessionTitle(sessions: { title: string }[]): string {
  const used = new Set(sessions.map((s) => s.title));
  if (!used.has("新会话")) return "新会话";
  for (let i = 2; i < 10_000; i += 1) {
    const t = `新会话（${i}）`;
    if (!used.has(t)) return t;
  }
  return `新会话 ${Date.now()}`;
}

const pendingSendRetryTimers = new Set<ReturnType<typeof setTimeout>>();

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const pool = Math.min(Math.max(1, limit), queue.length);
  await Promise.all(
    Array.from({ length: pool }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await worker(item);
      }
    }),
  );
}

export const useSessionStore = create<SessionState>((set, get) => {
  const applySubscriptionHealth = (
    sessionId: string,
    hasRemoteKey: boolean,
    sub?: SessionMessagesSubscribeResult,
  ) => {
    const health = resolveSubscriptionHealth(hasRemoteKey, sub);
    set((s) => ({
      subscriptionHealthBySession: { ...s.subscriptionHealthBySession, [sessionId]: health },
    }));
  };

  const rememberRetryableSend = (sessionId: string, input: SendMessageInput) => {
    set({ lastRetryableSend: { sessionId, input } });
  };

  const clearRetryableSend = () => {
    set({ lastRetryableSend: null });
  };

  const stopSending = () => set({ isSending: false, sendingSessionId: null });

  const patchLastUserSendStatus = (
    sessionId: string,
    status: "sending" | "failed" | undefined,
  ) => {
    set((s) => {
      const next = patchLastUserSendStatusInMap(s.messagesBySession, sessionId, status);
      if (next === s.messagesBySession) return s;
      return { messagesBySession: next };
    });
  };

  const scheduleSendMessageRetry = (
    sessionId: string,
    input: SendMessageInput,
    retryOpts: {
      skipUserAppend?: boolean;
      autoRetryAttempt?: number;
      compactionRetryAttempt?: number;
      idleRetryAttempt?: number;
    },
    delayMs: number,
    rescheduleAttempt = 0,
  ) => {
    const timer = window.setTimeout(() => {
      pendingSendRetryTimers.delete(timer);
      if (get().isSending) {
        if (rescheduleAttempt < 4) {
          scheduleSendMessageRetry(
            sessionId,
            input,
            retryOpts,
            2_000,
            rescheduleAttempt + 1,
          );
        }
        return;
      }
      if (!get().sessions.some((s) => s.id === sessionId)) {
        if (get().lastRetryableSend?.sessionId === sessionId) {
          clearRetryableSend();
        }
        return;
      }
      if (get().activeId !== sessionId) {
        get().selectSession(sessionId);
      }
      void get()
        .sendMessage(input, retryOpts)
        .catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          useUiStore.getState().showToast(msg.slice(0, TRUNCATE_TOAST), "error");
        });
    }, delayMs);
    pendingSendRetryTimers.add(timer);
  };

  const finalizeStepsOnSendError = () => {
    useStepStore.getState().finalizeStaleRunningSteps("skipped");
  };

  const maybeScheduleIdleTimeoutRetry = (
    sessionId: string,
    input: SendMessageInput,
    rawErr: string | undefined,
    opts?: { idleRetryAttempt?: number },
  ): boolean => {
    const err = rawErr?.trim() ?? "";
    if (!err || !isModelIdleTimeoutError(err)) return false;
    const attempt = opts?.idleRetryAttempt ?? 0;
    if (attempt >= 1) return false;
    useUiStore.getState().showToast("模型等待间隙超时，正在自动重试…", "info");
    scheduleSendMessageRetry(
      sessionId,
      input,
      { skipUserAppend: true, idleRetryAttempt: attempt + 1 },
      2_000,
    );
    return true;
  };

  const settleDisconnectSend = (
    sessionId: string,
    sessionKey: string,
    sendStartedAtMs: number,
    originalInput: SendMessageInput,
    opts?: { showToast?: boolean; setBanner?: boolean },
  ) => {
    const msgs = get().messagesBySession[sessionId] ?? [];
    const offerRetry = shouldOfferSendRetryAfterAbort(msgs);
    if (offerRetry) {
      rememberRetryableSend(sessionId, originalInput);
    } else {
      clearRetryableSend();
    }
    if (sessionKey.trim()) {
      registerPendingSendRecovery({
        sessionId,
        sessionKey: sessionKey.trim(),
        sendStartedAtMs,
        originalInput,
      });
    }
    if (opts?.showToast !== false) {
      useUiStore.getState().showToast(
        offerRetry
          ? "连接中断，任务可能在后台继续；重连后将自动同步结果。"
          : "已保存已输出内容，可点击「继续生成」从断点续写。",
        "info",
      );
    }
    if (opts?.setBanner !== false && !useGatewayStore.getState().autoReconnect) {
      useGatewayStore.setState({
        lastError: offerRetry ? SEND_ABORT_DISCONNECT_BANNER : null,
      });
    }
    finalizeStepsOnSendError();
    void finalizeTaskDelivery(sessionId, sendStartedAtMs, {
      hadAssistantText: false,
      toast: false,
      cancelled: true,
      cancelReason: "disconnect",
    }).catch(() => undefined);
  };

  const appendAssistantReplyIfAbsent = async (
    sessionId: string,
    content: string,
    sinceMs?: number,
  ): Promise<LocalMessageRow | null> => upsertTurnAssistantMessage(sessionId, content, { sinceMs });

  const appendStoppedNoticeIfNeeded = async (sessionId: string, sinceMs?: number) => {
    if (appendStoppedNoticeInFlight.has(sessionId)) return;
    get().flushStreamingDraftsNow();
    const persisted = await get().persistStreamingDraftIfNeeded(sessionId, sinceMs);
    if (persisted) return;
    const msgs0 = get().messagesBySession[sessionId] ?? [];
    const last0 = msgs0[msgs0.length - 1];
    const alreadyDelivered =
      last0?.role === "assistant" &&
      last0.content !== ASSISTANT_STOPPED_NOTICE &&
      last0.content !== ASSISTANT_REPLY_TIMEOUT_NOTICE;
    if (alreadyDelivered) return;
    if (last0?.role === "assistant" && last0.content === ASSISTANT_STOPPED_NOTICE) return;
    if (!guardLocalAppend(ASSISTANT_STOPPED_NOTICE)) return;
    appendStoppedNoticeInFlight.add(sessionId);
    try {
      const row = await invokeWithAuthRetry<LocalMessageRow>("db_append_message", {
        sessionId,
        role: "assistant",
        content: ASSISTANT_STOPPED_NOTICE,
      });
      get().appendLocalMessage(sessionId, row);
    } catch {
      /* ignore */
    } finally {
      appendStoppedNoticeInFlight.delete(sessionId);
    }
  };

  const reconcileRemoteKey = async (
    sessionId: string,
    askedKey: string,
    sub: SessionMessagesSubscribeResult,
  ): Promise<string> => {
    if (!sub.eventsSubscribed) {
      noteWeakSubscription(sessionId);
    }
    const canonical = pickCanonicalRemoteKey(askedKey, sub);
    if (shouldPersistCanonicalKey(askedKey, canonical)) {
      await invokeWithAuthRetry("db_set_remote_session_key", {
        sessionId,
        remoteSessionKey: canonical,
      });
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, remoteSessionKey: canonical } : x)),
      }));
    }
    applySubscriptionHealth(sessionId, Boolean(canonical || askedKey.trim()), sub);
    return canonical || askedKey.trim();
  };

  return {
  sessions: [],
  activeId: null,
  sessionsLoading: true,
  messagesBySession: {},
  hasMoreBySession: {},
  loadingOlderBySession: {},
  isSending: false,
  queuedSendPending: false,
  sendingSessionId: null,
  sendProgressLabel: null,
  streamingDraftBySession: {},
  thinkingDraftBySession: {},
  subscriptionHealthBySession: {},
  loadingMessagesBySession: {},
  syncingHistoryBySession: {},
  lastRetryableSend: null,
  subscribingSessionId: null,

  setSendProgress: (label) => set({ sendProgressLabel: label }),

  setStreamingDraft: (sessionId, text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      removeStreamingDraftPending(sessionId);
      get().clearStreamingDraft(sessionId);
      return;
    }
    setStreamingDraftPending(sessionId, text);
    scheduleStreamingDraftFlush(set);
  },

  clearStreamingDraft: (sessionId) => {
    removeStreamingDraftPending(sessionId);
    set((s) => {
      if (!(sessionId in s.streamingDraftBySession)) return s;
      const next = { ...s.streamingDraftBySession };
      delete next[sessionId];
      return { streamingDraftBySession: next };
    });
  },

  clearStreamingDraftForActive: () => {
    const id = get().activeId;
    if (id) get().clearStreamingDraft(id);
  },

  setThinkingDraft: (sessionId, text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      removeThinkingDraftPending(sessionId);
      get().clearThinkingDraft(sessionId);
      return;
    }
    setThinkingDraftPending(sessionId, text);
    scheduleThinkingDraftFlush(set);
  },

  clearThinkingDraft: (sessionId) => {
    removeThinkingDraftPending(sessionId);
    set((s) => {
      if (!(sessionId in s.thinkingDraftBySession)) return s;
      const next = { ...s.thinkingDraftBySession };
      delete next[sessionId];
      return { thinkingDraftBySession: next };
    });
  },

  clearThinkingDraftForActive: () => {
    const id = get().activeId;
    if (id) get().clearThinkingDraft(id);
  },

  flushStreamingDraftsNow: () => {
    flushStreamingDrafts(set);
    flushThinkingDrafts(set);
  },

  getStreamingDraftSnapshot: (sessionId) => {
    const pendingBody = getStreamingDraftPendingSnapshot()[sessionId];
    const pendingThinking = getThinkingDraftPendingSnapshot()[sessionId];
    const body = (pendingBody ?? get().streamingDraftBySession[sessionId] ?? "").trim();
    const thinking = (pendingThinking ?? get().thinkingDraftBySession[sessionId] ?? "").trim();
    return { body, thinking };
  },

  persistStreamingDraftIfNeeded: async (sessionId, sinceMs) => {
    get().flushStreamingDraftsNow();
    const { body, thinking } = get().getStreamingDraftSnapshot(sessionId);
    if (!body) return false;
    const messages = get().messagesBySession[sessionId] ?? [];
    return persistStreamingDraftToDb(sessionId, body, messages, {
      sinceMs,
      thinking: thinking || undefined,
    });
  },

  resubscribeAllRemoteSessions: async (opts) => {
    if (!isTauriRuntime() || useGatewayStore.getState().connState !== "connected") return;
    if (opts?.background && useSessionStore.getState().isSending) return;
    const client = getGatewayClient();
    const state = get();
    const activeSess = state.activeId ? state.sessions.find((s) => s.id === state.activeId) : null;
    const activeKey = activeSess?.remoteSessionKey?.trim();
    const maxKeys = opts?.background ? 8 : 24;
    const concurrency = opts?.background ? 1 : 2;
    const keys = [
      ...new Set(
        state.sessions
          .map((s) => s.remoteSessionKey?.trim())
          .filter((k): k is string => Boolean(k)),
      ),
    ].slice(0, maxKeys);

    const subscribeKey = async (rk: string) => {
      try {
        const sub = await ensureSessionsMessagesSubscribed(client, rk);
        const local = get().sessions.find(
          (s) =>
            s.remoteSessionKey?.trim() === rk ||
            s.remoteSessionKey?.trim()?.toLowerCase() === rk.toLowerCase(),
        );
        if (local) await reconcileRemoteKey(local.id, rk, sub);
      } catch {
        /* 单会话失败不阻断其余 */
      }
    };

    if (activeKey) await subscribeKey(activeKey);
    const rest = keys.filter((k) => k !== activeKey);
    if (rest.length > 0) {
      await mapWithConcurrency(rest, concurrency, subscribeKey);
    }
  },

  refreshSessionSubscription: async (sessionId) => {
    if (!isTauriRuntime() || useGatewayStore.getState().connState !== "connected") return;
    const sess = get().sessions.find((x) => x.id === sessionId);
    const rk = sess?.remoteSessionKey?.trim();
    if (!rk) {
      await get().syncRemoteForActive();
      return;
    }
    set({ subscribingSessionId: sessionId });
    set((s) => ({
      subscriptionHealthBySession: { ...s.subscriptionHealthBySession, [sessionId]: "pending" },
    }));
    try {
      invalidateSessionSubscription(rk);
      const sub = await ensureSessionsMessagesSubscribed(getGatewayClient(), rk);
      await reconcileRemoteKey(sessionId, rk, sub);
      void get().backfillHistoryFromGateway(sessionId, { reload: true, silent: true });
      useUiStore.getState().showToast("已刷新会话订阅", "success");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast("刷新订阅失败：" + raw.slice(0, TRUNCATE_TOAST), "error");
      throw e;
    } finally {
      set({ subscribingSessionId: null });
      if (get().subscriptionHealthBySession[sessionId] === "pending") {
        applySubscriptionHealth(sessionId, Boolean(rk));
      }
    }
  },

  markSubscriptionsDisconnected: () => {
    set((s) => {
      const next = { ...s.subscriptionHealthBySession };
      for (const sess of s.sessions) {
        next[sess.id] = sess.remoteSessionKey?.trim() ? "push_weak" : "local_only";
      }
      return { subscriptionHealthBySession: next };
    });
  },

  dismissRetryableSend: () => {
    clearRetryableSend();
  },

  retryLastSend: async () => {
    const r = get().lastRetryableSend;
    if (!r || get().isSending || get().queuedSendPending) return;
    if (get().activeId !== r.sessionId) {
      get().selectSession(r.sessionId);
    }
    try {
      await get().sendMessage(r.input, { skipUserAppend: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg.slice(0, TRUNCATE_TOAST), "error");
    }
  },

  abortActiveSend: (reason: "user" | "disconnect" = "user") => {
    if (get().queuedSendPending && !get().isSending) {
      clearQueuedDisconnectedSend();
      const sid = get().sendingSessionId;
      set({ queuedSendPending: false, sendingSessionId: null, sendProgressLabel: null });
      if (sid) patchLastUserSendStatus(sid, "failed");
      if (reason === "user") {
        useUiStore.getState().showToast("已取消排队发送", "info");
      }
      return;
    }
    const h = getActiveSendHandle();
    if (!h) return;
    if (reason === "user") {
      const client = getGatewayClient();
      void client
        .request("chat.abort", { sessionKey: h.sessionKey }, { timeoutMs: 20_000 })
        .catch(() => undefined);
      markActiveSendUserAbort();
    } else {
      markActiveSendDisconnectAbort();
    }
    // 流式草稿由 sendMessage finally 统一落库后清除，避免中断时丢失已显示内容
  },

  flushQueuedSendAfterReconnect: async () => {
    if (get().isSending) return;
    const q = takeQueuedDisconnectedSend();
    if (!q) {
      if (get().queuedSendPending) {
        set({ queuedSendPending: false });
      }
      return;
    }
    set({ queuedSendPending: false, sendProgressLabel: null });
    if (useGatewayStore.getState().connState !== "connected") {
      enqueueDisconnectedSend(q);
      set({
        queuedSendPending: true,
        sendingSessionId: q.sessionId,
        sendProgressLabel: SEND_PROGRESS.WAITING_GATEWAY,
      });
      return;
    }
    if (q.sessionId && get().activeId !== q.sessionId) {
      get().selectSession(q.sessionId);
    }
    try {
      await get().sendMessage(q.input, q.opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg.slice(0, TRUNCATE_TOAST), "error");
    }
  },

  releaseActiveSendWaitOnly: () => {
    markActiveSendDisconnectAbort();
  },

  finishActiveSendFromWebSocket: (sessionKey: string) => {
    if (!markActiveSendWsComplete(sessionKey)) return;
    // 先开步骤摄入宽限期，再 abort；避免 finally 尚未执行时晚到 tool 事件被丢弃
    extendStepIngestGrace(2500);
    clearRetryableSend();
    useStepStore.getState().finalizeStaleRunningSteps();
  },

  touchSessionActivity: (sessionId, updatedAt) => {
    const at = updatedAt ?? String(Date.now());
    set((s) => ({
      sessions: sortSessionsByActivity(
        s.sessions.map((x) =>
          x.id === sessionId ? { ...x, updatedAt: at, lastMessageAt: at } : x,
        ),
      ),
    }));
  },

  loadSessions: async () => {
    if (!isTauriRuntime()) return;
    const listOnce = () =>
      invokeWithAuthRetry<LocalSessionRow[]>("db_list_sessions", {}, { timeoutMs: 30_000 });
    try {
      let rows: LocalSessionRow[];
      try {
        rows = await listOnce();
      } catch (first) {
        const firstMsg = first instanceof Error ? first.message : String(first);
        if (!isIpcTimeoutError(firstMsg)) throw first;
        await sleep(800);
        rows = await listOnce();
      }
      const subscriptionHealthBySession: Record<string, SessionSubscriptionHealth> = {};
      for (const row of rows) {
        subscriptionHealthBySession[row.id] = row.remoteSessionKey?.trim() ? "push_weak" : "local_only";
      }
      set((s) => ({
        sessions: sortSessionsByActivity(rows),
        activeId: s.activeId && rows.some((r) => r.id === s.activeId) ? s.activeId : null,
        subscriptionHealthBySession,
        sessionsLoading: false,
      }));
      const active = get().activeId;
      if (active) await get().loadMessages(active);
    } catch (e) {
      set({ sessionsLoading: false });
      const msg = e instanceof Error ? e.message : String(e);
      if (!useAuthStore.getState().isLoggedIn) return;
      useUiStore.getState().showToast(humanizeIpcFailure(msg), isIpcTimeoutError(msg) ? "info" : "error");
    }
  },

  renameSession: async (sessionId, title) => {
    if (!isTauriRuntime()) return;
    const t = title.trim();
    if (!t) {
      useUiStore.getState().showToast("会话标题不能为空", "warning");
      return;
    }
    try {
      await invokeWithAuthRetry("db_update_session_title", { sessionId, title: t });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, title: t } : x)),
    }));
  },

  enterComposeMode: () => {
    useStepStore.getState().clear();
    clearRetryableSend();
    persistLastActiveSessionId(null);
    const ui = useUiStore.getState();
    ui.clearComposerDraft("__new__");
    ui.bumpComposeReset();
    set((s) => {
      const recent = messagesCacheOrder.slice(-MESSAGES_CACHE_MAX);
      const keep = new Set(recent);
      const streamingDraftBySession = { ...s.streamingDraftBySession };
      const thinkingDraftBySession = { ...s.thinkingDraftBySession };
      for (const sid of Object.keys(streamingDraftBySession)) {
        if (!keep.has(sid)) delete streamingDraftBySession[sid];
      }
      for (const sid of Object.keys(thinkingDraftBySession)) {
        if (!keep.has(sid)) delete thinkingDraftBySession[sid];
      }
      return {
        activeId: null,
        messagesBySession: pruneMessagesCache(s.messagesBySession, recent),
        streamingDraftBySession,
        thinkingDraftBySession,
      };
    });
  },

  summarizeAndContinueInNewChat: async () => {
    if (get().isSending) {
      useUiStore.getState().showToast("请等待当前消息发送完成", "info");
      return;
    }
    const id = get().activeId;
    if (!id) {
      useUiStore.getState().showToast("请先选择要接续的对话", "info");
      return;
    }
    const messages = get().messagesBySession[id] ?? [];
    if (messages.length === 0) {
      useUiStore.getState().showToast("当前对话为空", "info");
      return;
    }
    const sess = get().sessions.find((s) => s.id === id);
    const key = sess?.remoteSessionKey?.trim();
    if (key && useGatewayStore.getState().connState === "connected") {
      const compacted = await tryCompactionRecoveryForSession(key);
      if (compacted) {
        useUiStore.getState().showToast("已压缩上一对话上下文", "info");
        await get().backfillHistoryFromGateway(id, { reload: true, silent: true });
      }
    }
    let summary = buildSessionHandoffSummary(messages);
    const connected = useGatewayStore.getState().connState === "connected";
    if (connected && isLlmHandoffSummaryEnabled()) {
      useUiStore.getState().showToast("正在生成对话摘要…", "info");
      const llm = await generateLlmHandoffSummary(messages);
      if (llm?.trim()) {
        summary = `【由模型生成的对话摘要】\n${llm.trim()}`;
      }
    }
    const agentId = sess?.agentId ?? undefined;
    await get().createSession(agentId ?? undefined);
    const newId = get().activeId;
    if (!newId) return;
    if (!connected) {
      useUiStore.getState().showToast("服务未连接，已新建对话但未自动发送摘要", "info");
      return;
    }
    useUiStore.getState().showToast("已新建对话并带入摘要", "success");
    await get().sendMessage(
      "请接续上一对话继续办事：\n\n" + summary,
      { taskTitle: "接续上一对话" },
    );
  },

  createSession: async (agentId?) => {
    if (!isTauriRuntime()) return;
    useStepStore.getState().clear();
    const defaultTitle = nextDefaultSessionTitle(get().sessions);
    let row: LocalSessionRow;
    try {
      row = await invokeWithAuthRetry<LocalSessionRow>("db_create_session", {
        title: defaultTitle,
        agentId: agentId ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    let withRemote = row;
    if (agentId?.trim()) {
      withRemote = { ...withRemote, agentId: agentId.trim() };
    }
    if (useGatewayStore.getState().connState === "connected") {
      try {
        const rk = await gatewayCreateRemoteSession(defaultTitle, row.id, agentId?.trim() || undefined);
        if (rk) {
          await invokeWithAuthRetry("db_set_remote_session_key", {
            sessionId: row.id,
            remoteSessionKey: rk,
          });
          withRemote = { ...row, remoteSessionKey: rk, updatedAt: row.updatedAt };
          if (agentId?.trim()) {
            withRemote = { ...withRemote, agentId: agentId.trim() };
          }
          try {
            const sub = await ensureSessionsMessagesSubscribed(getGatewayClient(), rk);
            const useKey = await reconcileRemoteKey(row.id, rk, sub);
            withRemote = { ...withRemote, remoteSessionKey: useKey };
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        useGatewayStore.setState({
          lastError: "远端会话创建失败：" + raw.slice(0, TRUNCATE_ERROR_LONG) + "。可稍后在侧栏「同步到云端」重试。",
        });
        useUiStore.getState().showToast("远端会话未创建，消息仅保存在本地", "error");
      }
    }
    set((s) => {
      const health =
        s.subscriptionHealthBySession[withRemote.id] ??
        (withRemote.remoteSessionKey?.trim() ? "push_weak" : "local_only");
      return {
        sessions: [withRemote, ...s.sessions],
        activeId: withRemote.id,
        subscriptionHealthBySession: { ...s.subscriptionHealthBySession, [withRemote.id]: health },
      };
    });
    await get().loadMessages(withRemote.id);
    if (useGatewayStore.getState().connState === "connected") {
      const cur = get().sessions.find((x) => x.id === withRemote.id);
      if (cur && !cur.remoteSessionKey?.trim()) {
        await get().syncRemoteForActive();
      }
    }
  },

  deleteSession: async (id) => {
    if (!isTauriRuntime()) return;
    const prevActive = get().activeId;
    removeStreamingDraftPending(id);
    removeThinkingDraftPending(id);
    messagesLoadGen.delete(id);
    const cacheIdx = messagesCacheOrder.indexOf(id);
    if (cacheIdx >= 0) messagesCacheOrder.splice(cacheIdx, 1);
    try {
      await invokeWithAuthRetry("db_delete_session", { sessionId: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id);
      const restMsgs = { ...s.messagesBySession };
      delete restMsgs[id];
      let activeId = s.activeId;
      if (activeId === id) activeId = null;
      return { sessions, activeId, messagesBySession: restMsgs };
    });
    const next = get().activeId;
    if (prevActive !== next) useStepStore.getState().clear();
    if (next) await get().loadMessages(next);
  },

  selectSession: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    /* 全局时间线曾与「当前侧边栏会话」混在一起，残留 running 会导致别的会话里也看到「进行中」 */
    useStepStore.getState().clear();
    touchMessageCache(id);
    set((s) => {
      const recent = messagesCacheOrder.slice(-MESSAGES_CACHE_MAX);
      return {
        activeId: id,
        messagesBySession: pruneMessagesCache(s.messagesBySession, [id, ...recent]),
      };
    });
    void get().loadMessages(id);
    if (useGatewayStore.getState().connState === "connected") {
      const sess = get().sessions.find((x) => x.id === id);
      const rk = sess?.remoteSessionKey?.trim();
      if (rk) {
        set((s) => ({
          subscriptionHealthBySession: { ...s.subscriptionHealthBySession, [id]: "pending" },
        }));
        void ensureSessionsMessagesSubscribed(getGatewayClient(), rk)
          .then((sub) => reconcileRemoteKey(id, rk, sub))
          .catch(() => {
            applySubscriptionHealth(id, true);
          });
      } else {
        applySubscriptionHealth(id, false);
        void get().syncRemoteForActive();
      }
    }
  },

  loadMessages: async (sessionId) => {
    if (!isTauriRuntime()) return;
    set((s) => ({
      loadingMessagesBySession: { ...s.loadingMessagesBySession, [sessionId]: true },
    }));
    const gen = (messagesLoadGen.get(sessionId) ?? 0) + 1;
    messagesLoadGen.set(sessionId, gen);
    try {
      const sess = get().sessions.find((s) => s.id === sessionId);
      const remoteKey = sess?.remoteSessionKey?.trim();
      const connected = useGatewayStore.getState().connState === "connected";
      const invokeList = () =>
        invokeWithAuthRetry<MessageListPage>("db_list_messages", {
          sessionId,
          limit: MESSAGE_LOAD_LIMIT,
        });

      let page: MessageListPage;
      if (isTauriRuntime()) {
        await invokeWithAuthRetry("db_collapse_replayed_messages", { sessionId }).catch(() => undefined);
      }
      if (connected && remoteKey) {
        const client = getGatewayClient();
        const synced = await syncSessionMessagesFromGateway({
          sessionId,
          remoteSessionKey: remoteKey,
          connConnected: true,
          invokeListMessages: invokeList,
          request: (m, p, reqOpts) => client.request(m, p, reqOpts),
          sessionCreatedAt: sess?.createdAt,
          isSendBlocked: () => get().isSending && get().sendingSessionId === sessionId,
          getLatestLocalMessages: () => get().messagesBySession[sessionId] ?? [],
        });
        page = synced.page;
      } else {
        page = await invokeList();
      }

      if (messagesLoadGen.get(sessionId) !== gen) return;
      const compacted = await compactSupersededAssistantMessagesInDb(sessionId, page.messages);
      touchMessageCache(sessionId);
      set((s) => ({
        messagesBySession: { ...s.messagesBySession, [sessionId]: compacted },
        hasMoreBySession: { ...s.hasMoreBySession, [sessionId]: page.hasMore },
        loadingMessagesBySession: { ...s.loadingMessagesBySession, [sessionId]: false },
      }));
    } catch (e) {
      if (messagesLoadGen.get(sessionId) !== gen) return;
      set((s) => ({
        loadingMessagesBySession: { ...s.loadingMessagesBySession, [sessionId]: false },
      }));
      const msg = e instanceof Error ? e.message : String(e);
      if (!useAuthStore.getState().isLoggedIn) return;
      useUiStore.getState().showToast(msg, "error");
    }
  },

  backfillHistoryFromGateway: async (sessionId, opts) => {
    if (!isTauriRuntime()) return 0;
    const inflight = backfillPromises.get(sessionId);
    if (inflight) return inflight;
    const task = (async () => {
      set((s) => ({
        syncingHistoryBySession: { ...s.syncingHistoryBySession, [sessionId]: true },
      }));
      try {
        const sess = get().sessions.find((s) => s.id === sessionId);
        const key = sess?.remoteSessionKey?.trim();
        if (!key || useGatewayStore.getState().connState !== "connected") return 0;
        const client = getGatewayClient();
        const stored = await invokeWithAuthRetry<MessageListPage>("db_list_messages", {
          sessionId,
          limit: MESSAGE_LOAD_LIMIT,
        }).catch(() => null);
        const localMessages = stored?.messages ?? get().messagesBySession[sessionId] ?? [];
        const result = await backfillSessionHistoryFromGateway({
          sessionId,
          remoteSessionKey: key,
          localMessages,
          request: (m, p, reqOpts) => client.request(m, p, reqOpts),
          sessionCreatedAt: sess?.createdAt,
          getLatestLocalMessages: () => {
            const live = get().messagesBySession[sessionId] ?? [];
            return live.length >= localMessages.length ? live : localMessages;
          },
          isSendBlocked: () => get().isSending && get().sendingSessionId === sessionId,
        });
        if (opts?.reload && result.appended > 0) {
          await get().loadMessages(sessionId);
        }
        if (!opts?.silent && result.appended > 0) {
          useUiStore.getState().showToast(`已同步 ${result.appended} 条历史消息`, "success");
        }
        return result.appended;
      } finally {
        set((s) => ({
          syncingHistoryBySession: { ...s.syncingHistoryBySession, [sessionId]: false },
        }));
        backfillPromises.delete(sessionId);
      }
    })();
    backfillPromises.set(sessionId, task);
    return task;
  },

  loadOlderMessages: async (sessionId) => {
    if (!isTauriRuntime()) return;
    if (get().loadingOlderBySession[sessionId]) return;
    const existing = get().messagesBySession[sessionId] ?? [];
    if (!get().hasMoreBySession[sessionId] || existing.length === 0) return;
    const beforeCreatedAt = existing[0]?.createdAt;
    if (!beforeCreatedAt) return;

    set((s) => ({
      loadingOlderBySession: { ...s.loadingOlderBySession, [sessionId]: true },
    }));
    try {
      const page = await invokeWithAuthRetry<MessageListPage>("db_list_messages", {
        sessionId,
        limit: MESSAGE_LOAD_LIMIT,
        beforeCreatedAt,
      });
      if (!page.messages.length) {
        set((s) => ({
          hasMoreBySession: { ...s.hasMoreBySession, [sessionId]: false },
        }));
        return;
      }
      set((s) => {
        const cur = s.messagesBySession[sessionId] ?? [];
        const seen = new Set(cur.map((m) => m.id));
        const prepend = page.messages.filter((m) => !seen.has(m.id));
        return {
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: [...prepend, ...cur],
          },
          hasMoreBySession: { ...s.hasMoreBySession, [sessionId]: page.hasMore },
        };
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
    } finally {
      set((s) => ({
        loadingOlderBySession: { ...s.loadingOlderBySession, [sessionId]: false },
      }));
    }
  },

  appendLocalMessage: (sessionId, row) => {
    set((s) => ({
      messagesBySession: appendMessageToSessionMap(s.messagesBySession, sessionId, row),
    }));
  },

  clearSessionMessages: async (sessionId) => {
    if (!isTauriRuntime()) return;
    try {
      await invokeWithAuthRetry("db_clear_session_messages", { sessionId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: [] },
    }));
  },

  deleteMessage: async (sessionId, messageId) => {
    if (!isTauriRuntime()) return;
    try {
      await invokeWithAuthRetry("db_delete_message", { sessionId, messageId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    set((s) => {
      const list = s.messagesBySession[sessionId];
      if (!list?.length) return s;
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: list.filter((m) => m.id !== messageId),
        },
      };
    });
  },

  syncRemoteForActive: async () => {
    const id = get().activeId;
    if (!id || !isTauriRuntime()) return false;
    const sess = get().sessions.find((x) => x.id === id);
    if (!sess || sess.remoteSessionKey || useGatewayStore.getState().connState !== "connected") {
      return false;
    }
    let rk: string | undefined;
    try {
      rk = await gatewayCreateRemoteSession(sess.title, id, sess.agentId?.trim() || undefined);
    } catch (e) {
      useGatewayStore.setState({
        lastError: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
    if (rk) {
      try {
        await invokeWithAuthRetry("db_set_remote_session_key", { sessionId: id, remoteSessionKey: rk });
      } catch (e) {
        useGatewayStore.setState({
          lastError: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
      set((s) => ({
        sessions: s.sessions.map((x) => (x.id === id ? { ...x, remoteSessionKey: rk } : x)),
      }));
      try {
        const sub = await ensureSessionsMessagesSubscribed(getGatewayClient(), rk);
        await reconcileRemoteKey(id, rk, sub);
      } catch {
        /* ignore */
      }
      return true;
    }
    useGatewayStore.setState({
      lastError: "服务未返回新会话标识（sessions.create），请稍后重试或查看运行日志。",
    });
    return false;
  },

  setSessionAgent: async (sessionId, agentId) => {
    if (!isTauriRuntime()) return;
    const normalized = agentId?.trim() || null;
    try {
      await invokeWithAuthRetry("db_set_session_agent", { sessionId, agentId: normalized });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      useUiStore.getState().showToast(msg, "error");
      return;
    }
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, agentId: normalized ?? null } : x,
      ),
    }));
  },

  tryAutoTitleSession: async (sessionId) => {
    if (!isTauriRuntime()) return;
    const sess = get().sessions.find((x) => x.id === sessionId);
    if (!sess) return;

    const msgs = get().messagesBySession[sessionId] ?? [];
    const userTexts = msgs
      .filter((m) => m.role === "user")
      .map((m) => parseMessageDisplayContent(m.displayContent, m.content).text);
    const assistantTexts = msgs.filter((m) => m.role === "assistant").map((m) => m.content);

    if (!shouldAutoTitleSession(sess.title, userTexts, assistantTexts)) return;

    const titleableAssistant = assistantTexts.find(isTitleableAssistantMessage);
    const title = deriveSessionTitle(userTexts[0] ?? "", titleableAssistant);
    if (!title || title === sess.title) return;
    await get().renameSession(sessionId, title);
  },

  sendMessage: async (input, opts) => {
    if (get().isSending || get().queuedSendPending) {
      const other = get().sendingSessionId && get().sendingSessionId !== get().activeId;
      useUiStore.getState().showToast(
        get().queuedSendPending
          ? "上一条消息正在排队等待连接"
          : other
            ? "另一会话正在生成回复，请稍候"
            : "上一条消息仍在发送中",
        "info",
      );
      return;
    }
    const originalInput = input;
    let localDisplay: string;
    let remotePayload: string;
    let workspaceTextFiles: SendMessageWorkspaceFile[] | undefined;
    let workspaceBatchId: string | undefined;
    let attachedFiles: MessageFileEntry[] | undefined;
    let sendStartedAtMs: number | undefined;
    let visionAttachments: SessionsSendAttachment[] | undefined;

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return;
      localDisplay = trimmed;
      remotePayload = trimmed;
    } else {
      localDisplay = input.localDisplay.trim();
      remotePayload = input.remotePayload.trim();
      workspaceTextFiles = input.workspaceTextFiles;
      workspaceBatchId = input.workspaceBatchId;
      attachedFiles = input.attachedFiles;
      sendStartedAtMs = input.sendStartedAtMs;
      visionAttachments = input.visionAttachments;
      if (!localDisplay && !remotePayload) return;
      if (!localDisplay) localDisplay = "（附件）";
      if (!remotePayload) remotePayload = localDisplay;
    }

    if (!guardLocalAppend(localDisplay)) return;
    useStepStore.getState().clear();
    const id = get().activeId;
    if (!id) {
      throw new Error("请先创建会话");
    }
    if (useGatewayStore.getState().connState !== "connected") {
      enqueueDisconnectedSend({ sessionId: id, input: originalInput, opts });
      set({
        queuedSendPending: true,
        sendingSessionId: id,
        sendProgressLabel: SEND_PROGRESS.WAITING_GATEWAY,
      });
      useUiStore.getState().showToast("服务未连接，已排队，连上后自动发送", "info");
      void requestDesktopConnect({ context: "queued-send", fastReopen: true });
      return;
    }
    clearTaskDeliverySummary(id);
    set({ isSending: true, sendingSessionId: id });
    beginActiveSendSettlement();
    get().clearStreamingDraft(id);
    get().clearThinkingDraft(id);
    let sess = get().sessions.find((x) => x.id === id);
    if (!sess) {
      stopSending();
      throw new Error("会话不存在");
    }

    if (!sess.remoteSessionKey) {
      await get().syncRemoteForActive();
      sess = get().sessions.find((x) => x.id === id) ?? sess;
    }

    const gwPre = useGatewayStore.getState();
    if (workspaceTextFiles?.length && !opts?.skipUserAppend) {
      if (gwPre.connState !== "connected") {
        useGatewayStore.setState({
          lastError: "发送附件到工作区需要先连接本机服务。",
        });
        stopSending();
        return;
      }
      if (!sess.remoteSessionKey?.trim()) {
        useGatewayStore.setState({
          lastError: "请先完成「同步到云端」后再发送工作区附件。",
        });
        stopSending();
        return;
      }
      const upClient = getGatewayClient();
      const sessionAgentId = sess.agentId?.trim();
      const resolvedAgentId = sessionAgentId || (await resolveDefaultAgentId((m, p) => upClient.request(m, p)));
      const agentId = resolvedAgentId?.trim();
      if (!agentId) {
        useGatewayStore.setState({
          lastError:
            "无法确定默认助手，不能写入工作区。请确认本机服务已连接后重试。",
        });
        stopSending();
        return;
      }
      try {
        const getRaw = await upClient.request("agents.files.get", {
          agentId,
          name: OPENCLAW_STAGING_USER_FILENAME,
        });
        const existing = extractAgentsFilesGetContent(getRaw);
        const batchId =
          workspaceBatchId?.trim() ||
          crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        const staging = buildUserMdStagingSection(
          batchId,
          workspaceTextFiles.map((f) => ({ displayName: f.displayName, content: f.content })),
        );
        const merged = prependStagingToUserMd(existing, staging);
        assertMergedUserMdWithinLimit(merged);
        await upClient.request("agents.files.set", {
          agentId,
          name: OPENCLAW_STAGING_USER_FILENAME,
          content: merged,
        });
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        useGatewayStore.setState({
          lastError: "写入工作区失败：" + raw,
        });
        stopSending();
        return;
      }
    }

    if (!isTauriRuntime()) {
      stopSending();
      return;
    }

    const gwCheck = useGatewayStore.getState();
    if (gwCheck.connState !== "connected") {
      useGatewayStore.setState({ lastError: "请先连接本机服务后再发送。" });
      stopSending();
      return;
    }
    if (!sess.remoteSessionKey?.trim()) {
      useGatewayStore.setState({
        lastError: "本会话尚未同步到云端，请点击侧栏「同步到云端」后再试。",
      });
      stopSending();
      return;
    }

    if (!opts?.skipUserAppend) {
      const userDisplayContent =
        attachedFiles?.length
          ? encodeMessageDisplayContent(localDisplay, attachedFiles)
          : undefined;
      const userRow = await appendUserMessageWithFiles(id, localDisplay, userDisplayContent);
      set((s) => ({
        messagesBySession: appendMessageToSessionMap(s.messagesBySession, id, {
          ...userRow,
          sendStatus: "sending",
        }),
      }));
    } else {
      patchLastUserSendStatus(id, "sending");
    }

    const replyScanSinceMs = sendStartedAtMs ?? Date.now();
    const outboundSendId = crypto.randomUUID();
    const scheduleIncompleteContinue = (assistantText: string) => {
      scheduleIncompleteTurnContinue(id, outboundSendId, assistantText, {
        isSending: () => get().isSending,
        isConnected: () => useGatewayStore.getState().connState === "connected",
        showToast: (message, kind) => useUiStore.getState().showToast(message, kind),
        sendContinue: async (prompt) => {
          await get().sendMessage(prompt, { skipUserAppend: true });
        },
      });
    };
    const maybeAutoContinueAfterAbort = () => {
      const text = collectLastAssistantTextSinceLastUser(get().messagesBySession[id] ?? []);
      if (text && shouldScheduleIncompleteTurnContinue(text)) {
        scheduleIncompleteContinue(text);
      }
    };
    const kernelPrep = prepareSendKernel(remotePayload, {
      localDisplay,
      localOnlyMode: opts?.localOnlyMode,
      templateId: opts?.templateId,
      attachedFiles: attachedFiles?.map((f) => ({ name: f.name })),
      sendId: outboundSendId,
    });
    remotePayload = kernelPrep.remotePayload;
    useStepStore.getState().beginSend(outboundSendId, kernelPrep.initialPlanSteps);

    const gw = useGatewayStore.getState();
    if (gw.connState === "connected" && sess.remoteSessionKey?.trim()) {
      const remoteKey = sess.remoteSessionKey.trim();
      const client = getGatewayClient();
      let useKey = remoteKey;
      let eventsSubscribed = false;
      try {
        const sub = await ensureSessionsMessagesSubscribedForSend(client, remoteKey);
        eventsSubscribed = sub.eventsSubscribed;
        useKey = await reconcileRemoteKey(id, remoteKey, sub);
      } catch {
        /* 仍尝试用已有 key 发送 */
      }
      let baseline = baselineFromHistory({});
      const ac = new AbortController();
      const releaseHandle = () => {
        clearActiveSendHandle(ac);
        resetActiveSendFinishReason();
      };
      let sendRpcPromise: Promise<unknown> | null = null;
      try {
        setActiveSendHandle({
          controller: ac,
          sessionKey: useKey,
          sendStartedAtMs: replyScanSinceMs,
          lastWsEventAt: Date.now(),
        });

        const userMsgCount = (get().messagesBySession[id] ?? []).filter((m) => m.role === "user").length;
        const attachIdentityHint = userMsgCount <= 1 && !opts?.skipUserAppend;
        const rpcPayload = attachIdentityHint ? withYunTuAiIdentityHint(remotePayload) : remotePayload;

        const modelSelectionId = resolveModelSelectionForSend({
          sessionAgentId: sess.agentId,
          activeAgentId: useAgentStore.getState().activeAgentId,
          uiSelectionId: useModelStore.getState().selectionId,
        });
        const resolvedModelId = resolveSelectionToModelId(modelSelectionId);

        const prep = await prepareGatewaySend({
          sessionKey: useKey,
          rpcPayload,
          remotePayload,
          localMessages: get().messagesBySession[id] ?? [],
          localOnlyMode: opts?.localOnlyMode,
          taskOrchestration: kernelPrep.taskOrchestration,
          compactionRetryAttempt: opts?.compactionRetryAttempt,
          modelSelectionId,
          attachments: visionAttachments?.length ? visionAttachments : undefined,
          yuntuai: buildYuntuaiSendMetadata({
            sendId: outboundSendId,
            taskOrchestration: kernelPrep.taskOrchestration,
            attachedFiles: attachedFiles?.map((f) => ({ name: f.name })),
            remotePayload,
          }),
          request: (m, p, reqOpts) => client.request(m, p, reqOpts),
          onProgress: (label) => {
            if (label === SEND_PROGRESS.COMPACTING_CONTEXT) {
              useGatewayStore.setState({ startupPhase: label });
            }
          },
          onCompacted: () => {
            useUiStore.getState().showToast("已自动压缩长对话上下文，继续发送", "info");
          },
          onModelPatchError: (raw) => {
            useUiStore.getState().showToast(`会话模型未写入本机服务：${raw.slice(0, 120)}`, "warning");
          },
        });

        if (!prep.ok) {
          useGatewayStore.setState({ lastError: prep.message });
          releaseHandle();
          set({ isSending: false, sendingSessionId: null });
          endActiveSendSettlement();
          return;
        }

        baseline = prep.baseline;
        if (visionAttachments?.length) {
          await patchSessionImageModelForVision(useKey, resolvedModelId).catch(() => undefined);
        }

        const sendParams = prep.sendParams;
        const fallbackPollMs = prep.fallbackPollMs;

        const dispatchResult = await dispatchGatewayChatSend(
          client,
          sendParams,
          eventsSubscribed,
          { request: (m, p, reqOpts) => client.request(m, p, reqOpts) },
        );
        sendRpcPromise = dispatchResult.sendRpcPromise;

        const waitResult = await waitForGatewaySendReply({
          client,
          ac,
          eventsSubscribed,
          sendRpcPromise,
          sessionKey: useKey,
          baseline,
          fallbackPollMs,
          sendMode: dispatchResult.mode,
          compactionRetryAttempt: opts?.compactionRetryAttempt,
          getSendActivityMs: () =>
            Math.max(getActiveSendHandle()?.lastWsEventAt ?? 0, getLastAnyWsEventMs()),
          getLastAnyWsEventMs,
          consumeFinishReason: consumeActiveSendFinishReason,
          request: (m, p, reqOpts) => client.request(m, p, reqOpts),
        });

        if (waitResult.compactionRetryScheduled) {
          releaseHandle();
          set({ isSending: false, sendingSessionId: null });
          endActiveSendSettlement();
          await get().sendMessage(originalInput, {
            ...opts,
            skipUserAppend: true,
            compactionRetryAttempt: (opts?.compactionRetryAttempt ?? 0) + 1,
          });
          return;
        }

        const reply = waitResult.reply;
        baseline = waitResult.baseline;
        if (waitResult.upstreamErrorLine && !reply) {
          useGatewayStore.setState({
            lastError: waitResult.upstreamErrorLine,
          });
        }
        if (reply === "ws_complete") {
          clearRetryableSend();
          const msgs = get().messagesBySession[id] ?? [];
          const assistantText = collectRecentAssistantTextForDelivery(msgs, replyScanSinceMs);
          await finalizeGatewaySendSuccess({
            sessionId: id,
            sendId: outboundSendId,
            localDisplay,
            replyScanSinceMs,
            assistantText,
            showSuccessToast: false,
            guardLocalAppend,
            appendAssistantReply: async (content, sinceMs) => {
              await appendAssistantReplyIfAbsent(id, content, sinceMs);
            },
            tryAutoTitleSession: () => {
              void get().tryAutoTitleSession(id).catch(() => undefined);
            },
            scheduleIncompleteContinue,
          });
        } else if (reply === "aborted") {
          const finish = waitResult.capturedFinishReason;
          if (finish === "disconnect") {
            await get().persistStreamingDraftIfNeeded(id, replyScanSinceMs).catch(() => false);
            settleDisconnectSend(id, useKey, replyScanSinceMs, originalInput);
            if (!shouldOfferSendRetryAfterAbort(get().messagesBySession[id] ?? [])) {
              maybeAutoContinueAfterAbort();
            }
          } else if (finish === "gateway_error") {
            await get().persistStreamingDraftIfNeeded(id, replyScanSinceMs).catch(() => false);
            const msgs = get().messagesBySession[id] ?? [];
            const rawErr = (waitResult.upstreamErrorLine ?? consumeLastGatewayAbortError() ?? "").trim();
            if (shouldOfferSendRetryAfterAbort(msgs)) {
              rememberRetryableSend(id, originalInput);
              useGatewayStore.setState({
                lastError: rawErr ? humanizeAssistantRuntimeError(rawErr) : SEND_ABORT_GATEWAY_ERROR_BANNER,
              });
            } else {
              clearRetryableSend();
              useGatewayStore.setState({ lastError: null });
              maybeAutoContinueAfterAbort();
            }
            finalizeStepsOnSendError();
          } else if (finish === "timeout") {
            await get().persistStreamingDraftIfNeeded(id, replyScanSinceMs).catch(() => false);
            const msgs = get().messagesBySession[id] ?? [];
            if (shouldOfferSendRetryAfterAbort(msgs)) {
              rememberRetryableSend(id, originalInput);
              const notice = waitResult.upstreamErrorLine && /model idle timeout|llm request timed out/i.test(waitResult.upstreamErrorLine)
                ? ASSISTANT_MODEL_IDLE_TIMEOUT_NOTICE
                : ASSISTANT_RUN_TIMEOUT_NOTICE;
              if (guardLocalAppend(notice)) {
                await appendAssistantReplyIfAbsent(id, notice, replyScanSinceMs);
              }
            } else {
              clearRetryableSend();
              useGatewayStore.setState({ lastError: null });
              maybeAutoContinueAfterAbort();
            }
            finalizeStepsOnSendError();
          } else {
            clearRetryableSend();
            useStepStore.getState().finalizeStaleRunningSteps();
            await appendStoppedNoticeIfNeeded(id);
          }
        } else if (reply && !reply.startsWith("[错误]")) {
          clearRetryableSend();
          await appendAssistantReplyIfAbsent(id, reply, replyScanSinceMs);
          await finalizeGatewaySendSuccess({
            sessionId: id,
            sendId: outboundSendId,
            localDisplay,
            replyScanSinceMs,
            assistantText: reply,
            showSuccessToast: true,
            guardLocalAppend,
            appendAssistantReply: async (content, sinceMs) => {
              await appendAssistantReplyIfAbsent(id, content, sinceMs);
            },
            tryAutoTitleSession: () => {
              void get().tryAutoTitleSession(id).catch(() => undefined);
            },
            scheduleIncompleteContinue,
          });
        } else {
          const probed =
            (reply?.startsWith("[错误]") ? reply : undefined) ??
            waitResult.upstreamErrorLine ??
            (await fetchAssistantErrorAfterSend(
              (method, params) => client.request(method, params),
              useKey,
              baseline,
            ).catch(() => undefined));
          if (probed?.trim()) {
            const friendly = humanizeAssistantRuntimeError(probed);
            useGatewayStore.setState({ lastError: friendly });
            rememberRetryableSend(id, originalInput);
            if (guardLocalAppend(friendly)) {
              await appendAssistantReplyIfAbsent(id, friendly, replyScanSinceMs);
            }
            finalizeStepsOnSendError();
          } else {
            useGatewayStore.setState({
              lastError: "未收到云图AI 回复，已在对话中写入说明。请查看右侧「任务执行」与日志。",
            });
            rememberRetryableSend(id, originalInput);
            if (guardLocalAppend(ASSISTANT_REPLY_TIMEOUT_NOTICE)) {
              const row = await invokeWithAuthRetry<LocalMessageRow>("db_append_message", {
                sessionId: id,
                role: "assistant",
                content: ASSISTANT_REPLY_TIMEOUT_NOTICE,
              });
              get().appendLocalMessage(id, row);
            }
            useStepStore.getState().clear();
          }
        }
      } catch (e) {
        const capturedFinishReason = ac.signal.aborted ? consumeActiveSendFinishReason() : null;
        await handleGatewaySendCatch({
          error: e,
          signalAborted: ac.signal.aborted,
          capturedFinishReason,
          replyScanSinceMs,
          sendOpts: opts,
          hooks: {
            guardLocalAppend,
            appendAssistantReply: async (content: string, sinceMs: number) => {
              await appendAssistantReplyIfAbsent(id, content, sinceMs);
            },
            finalizeStepsOnSendError,
            rememberRetryableSend: () => rememberRetryableSend(id, originalInput),
            clearRetryableSend,
            clearPendingSendRecovery,
            consumeGatewayAbortError: () => consumeLastGatewayAbortError(),
            consumeFinishReason: consumeActiveSendFinishReason,
            settleDisconnect: (disconnectOpts?) =>
              settleDisconnectSend(id, useKey, replyScanSinceMs, originalInput, disconnectOpts),
            appendStoppedNotice: (sinceMs: number) => appendStoppedNoticeIfNeeded(id, sinceMs),
            maybeScheduleIdleTimeoutRetry: (rawErr: string, extra?) =>
              maybeScheduleIdleTimeoutRetry(id, originalInput, rawErr, { ...opts, ...extra }),
            scheduleAutoRetry: (delayMs: number, nextAttempt: number) => {
              scheduleSendMessageRetry(
                id,
                originalInput,
                { skipUserAppend: true, autoRetryAttempt: nextAttempt },
                delayMs,
              );
            },
            shouldOfferSendRetry: () =>
              shouldOfferSendRetryAfterAbort(get().messagesBySession[id] ?? []),
          },
        });
      } finally {
        void sendRpcPromise?.catch(() => undefined);
        get().clearStreamingDraft(id);
        get().clearThinkingDraft(id);
        const retryable = get().lastRetryableSend?.sessionId === id;
        patchLastUserSendStatus(id, retryable ? "failed" : undefined);
        set({ isSending: false, sendingSessionId: null });
        releaseHandle();
        endActiveSendSettlement();
        /* 与 WebSocket 事件顺序解耦：轮次结束后稍晚再收敛仍标为 running 的步骤，避免「执行中」卡死 */
        const fin = () => useStepStore.getState().finalizeStaleRunningSteps();
        fin();
        queueMicrotask(fin);
        setTimeout(fin, 400);
        /* 极少数情况下工具事件晚于轮询结束到达，再补一次收敛 */
        setTimeout(fin, 2000);
        extendStepIngestGrace(2500);
      }
    } else {
      stopSending();
    }
  },
  resetForLogout: () => {
    for (const t of pendingSendRetryTimers) clearTimeout(t);
    pendingSendRetryTimers.clear();
    clearActiveSendState();
    resetChatEventDedupState();
    resetStreamingDraftBuffers();
    messagesCacheOrder.length = 0;
    messagesLoadGen.clear();
    clearQueuedDisconnectedSend();
    set({
      sessions: [],
      activeId: null,
      messagesBySession: {},
      hasMoreBySession: {},
      loadingOlderBySession: {},
      isSending: false,
      sendingSessionId: null,
      sendProgressLabel: null,
      streamingDraftBySession: {},
      thinkingDraftBySession: {},
      subscriptionHealthBySession: {},
      loadingMessagesBySession: {},
      syncingHistoryBySession: {},
      lastRetryableSend: null,
      subscribingSessionId: null,
      queuedSendPending: false,
    });
  },
  };
});
