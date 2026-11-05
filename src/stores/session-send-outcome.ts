import type { AssistantBaseline } from "../lib/openclaw/chat-history-sync";
import { fetchAssistantErrorAfterSend } from "../lib/openclaw/chat-history-sync";
import {
  ASSISTANT_MODEL_IDLE_TIMEOUT_NOTICE,
  ASSISTANT_RUN_TIMEOUT_NOTICE,
  humanizeGatewayTimeoutError,
  isAgentRunTimeoutError,
  SEND_ABORT_GATEWAY_ERROR_BANNER,
} from "../lib/openclaw/agent-run-timeout";
import {
  humanizeCompactionRecoveryError,
  isCompactionRecoveryError,
  tryCompactionRecoveryForSession,
} from "../lib/openclaw/compaction-recovery";
import { isContextLimitError } from "../lib/openclaw/context-limit-policy";
import {
  humanizeGatewaySendError,
  isRecoverableRelayKeyError,
  isRelayUpstreamBlockedError,
} from "../lib/openclaw/connection-resilience";
import { recoverRelayUpstreamAuth } from "../lib/openclaw/relay-auth-recovery";
import { humanizeAssistantRuntimeError, isMessagePresentationWarning } from "../lib/openclaw/runtime-error-policy";
import { ASSISTANT_REPLY_TIMEOUT_NOTICE } from "../lib/openclaw/send-wait";
import { parseAssistantMessageForBubble } from "../lib/chat/assistant-message-display";
import { isDeliveredAssistantContent } from "../lib/chat/persist-streaming-draft";
import { isInterruptedAssistantContent } from "../lib/chat/context-cards";
import { scheduleExternalJobFollowUp, shouldScheduleExternalJobFollowUp } from "../lib/openclaw/external-job-followup";
import {
  resetIncompleteTurnContinue,
  shouldScheduleIncompleteTurnContinue,
} from "../lib/openclaw/incomplete-turn-continue";
import {
  buildToolOnlyCompletionNotice,
  finalizeTaskDelivery,
  shouldPreferToolOnlyNotice,
} from "../lib/openclaw/task-delivery";
import {
  mergeParsedPlanIntoSteps,
  parseTaskPlanFromAssistant,
  scheduleParallelSubtasksFollowUp,
} from "../lib/openclaw/task-orchestration";
import { PRODUCT_NAME } from "../lib/product-brand";
import { useGatewayStore } from "./gatewayStore";
import { useStepStore } from "./stepStore";
import { useUiStore } from "./uiStore";
import type { GatewayRpcRequest, GatewaySendFinishReason, GatewaySendReply } from "./session-send-gateway";
import type { LocalMessageRow, SendMessageInput } from "./sessionStore";

/** 发送收尾扫描：合并正文、思考与原始 content，便于 job 追踪与交付判定。 */
export function collectRecentAssistantTextForDelivery(
  msgs: readonly LocalMessageRow[],
  sinceMs: number,
): string {
  const row = [...msgs]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        Date.parse(m.createdAt) >= sinceMs - 2_000,
    );
  if (!row) return "";
  const parsed = parseAssistantMessageForBubble(row.displayContent, row.content);
  return [parsed.text, parsed.thinking, row.content]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("\n\n");
}

export type GatewaySendOutcomeHooks = {
  guardLocalAppend: (content: string) => boolean;
  appendAssistantReply: (content: string, sinceMs: number) => Promise<void>;
  getRecentAssistantText: (sinceMs: number) => string;
  tryAutoTitleSession: () => void;
  persistStreamingDraftIfNeeded: (sinceMs: number) => Promise<boolean>;
  finalizeStepsOnSendError: () => void;
  maybeScheduleIdleTimeoutRetry: (
    rawErr: string | undefined,
    extra?: { idleRetryAttempt?: number },
  ) => boolean;
  scheduleCompactionRetry: (attempt: number) => void;
  settleDisconnect: (opts?: { showToast?: boolean; setBanner?: boolean }) => void;
  appendStoppedNotice: (sinceMs: number) => Promise<void>;
  rememberRetryableSend: () => void;
  clearRetryableSend: () => void;
  clearPendingSendRecovery: () => void;
  consumeGatewayAbortError: () => string | null;
  hasDeliveredAssistantSinceLastUser: () => boolean;
  shouldOfferSendRetryAfterAbort?: () => boolean;
  scheduleIncompleteContinue?: (assistantText: string) => void;
};

export type SettleGatewaySendOutcomeOpts = {
  sessionId: string;
  sendId: string;
  localDisplay: string;
  sessionKey: string;
  originalInput: SendMessageInput;
  sendOpts?: {
    compactionRetryAttempt?: number;
    idleRetryAttempt?: number;
  };
  reply: GatewaySendReply;
  upstreamErrorLine?: string;
  compactionRetryScheduled: boolean;
  capturedFinishReason: GatewaySendFinishReason;
  baseline: AssistantBaseline;
  replyScanSinceMs: number;
  request: GatewayRpcRequest;
  hooks: GatewaySendOutcomeHooks;
};

function assistantTimeoutNotice(rawErr?: string): string {
  if (rawErr && /model idle timeout|llm request timed out/i.test(rawErr)) {
    return ASSISTANT_MODEL_IDLE_TIMEOUT_NOTICE;
  }
  return ASSISTANT_RUN_TIMEOUT_NOTICE;
}

/** ws_complete 与 poll 成功路径的统一验收（sessionStore / settleGatewaySendOutcome 共用）。 */
export async function finalizeGatewaySendSuccess(opts: {
  sessionId: string;
  sendId: string;
  localDisplay: string;
  replyScanSinceMs: number;
  assistantText: string;
  showSuccessToast: boolean;
  guardLocalAppend: (content: string) => boolean;
  appendAssistantReply: (content: string, sinceMs: number) => Promise<void>;
  tryAutoTitleSession: () => void;
  scheduleIncompleteContinue?: (assistantText: string) => void;
}): Promise<void> {
  useGatewayStore.setState({ lastError: null });
  useStepStore.getState().finalizeStaleRunningSteps();
  const text = opts.assistantText?.trim() ?? "";
  const interrupted = isInterruptedAssistantContent(text);
  const delivered = Boolean(text) && isDeliveredAssistantContent(text) && !interrupted;
  if (delivered) {
    resetIncompleteTurnContinue(opts.sessionId);
  }
  const parsedPlan = parseTaskPlanFromAssistant(opts.assistantText);
  if (parsedPlan) {
    useStepStore.getState().replaceSteps(
      mergeParsedPlanIntoSteps(useStepStore.getState().steps, parsedPlan, opts.sendId),
    );
  }
  void finalizeTaskDelivery(opts.sessionId, opts.replyScanSinceMs, {
    hadAssistantText: delivered,
    assistantText: opts.assistantText,
    toast: opts.showSuccessToast,
  }).catch(() => undefined);
  scheduleExternalJobFollowUp(
    opts.sessionId,
    opts.sendId,
    opts.assistantText,
    opts.localDisplay,
    {
      isConnected: () => useGatewayStore.getState().connState === "connected",
      showToast: (message, kind) => useUiStore.getState().showToast(message, kind),
      openSidePanel: () => useUiStore.getState().requestOpenSidePanel(),
      appendBlock: async (block) => {
        if (opts.guardLocalAppend(block)) {
          await opts.appendAssistantReply(block, Date.now());
        }
      },
    },
  );
  if (
    text &&
    !shouldScheduleExternalJobFollowUp(text) &&
    (interrupted || !delivered || shouldScheduleIncompleteTurnContinue(text))
  ) {
    if (opts.scheduleIncompleteContinue) {
      opts.scheduleIncompleteContinue(text);
    } else if (!delivered) {
      const notice =
        "【任务跟进中】本轮仅返回中间状态或推理过程，未形成可交付结论。请查看右侧任务进度，或直接追问「继续汇报结果」。";
      if (opts.guardLocalAppend(notice)) {
        await opts.appendAssistantReply(notice, Date.now());
      }
    }
  }
  scheduleParallelSubtasksFollowUp(
    opts.sessionId,
    opts.sendId,
    opts.localDisplay,
    opts.assistantText,
    {
      isConnected: () => useGatewayStore.getState().connState === "connected",
      showToast: (message, kind) => useUiStore.getState().showToast(message, kind),
      openSidePanel: () => useUiStore.getState().requestOpenSidePanel(),
      appendBlock: async (block) => {
        if (opts.guardLocalAppend(block)) {
          await opts.appendAssistantReply(block, Date.now());
        }
      },
    },
  );
  opts.tryAutoTitleSession();
}

/** 网关发送轮次结束后的回复/错误收尾（从 sessionStore 拆出）。 */
export async function settleGatewaySendOutcome(opts: SettleGatewaySendOutcomeOpts): Promise<void> {
  const {
    sessionId,
    sendId,
    localDisplay,
    sessionKey,
    replyScanSinceMs,
    hooks,
    request,
    sendOpts,
  } = opts;
  let { upstreamErrorLine } = opts;
  const { reply, capturedFinishReason, baseline } = opts;
  const compactionRetryScheduled = opts.compactionRetryScheduled;

  if (reply === "ws_complete") {
    hooks.clearPendingSendRecovery();
    hooks.clearRetryableSend();
    const assistantText = hooks.getRecentAssistantText(replyScanSinceMs);
    await finalizeGatewaySendSuccess({
      sessionId,
      sendId,
      localDisplay,
      replyScanSinceMs,
      assistantText,
      showSuccessToast: false,
      guardLocalAppend: hooks.guardLocalAppend,
      appendAssistantReply: hooks.appendAssistantReply,
      tryAutoTitleSession: hooks.tryAutoTitleSession,
    });
    return;
  }

  if (reply === "aborted") {
    let finishReason = capturedFinishReason;
    if (finishReason === "disconnect" || finishReason === "gateway_error") {
      const timeoutProbe =
        upstreamErrorLine ??
        (await fetchAssistantErrorAfterSend(request, sessionKey, baseline).catch(() => undefined));
      if (timeoutProbe && isAgentRunTimeoutError(timeoutProbe)) {
        finishReason = "timeout";
        upstreamErrorLine = timeoutProbe;
      }
    }
    if (finishReason === "timeout") {
      hooks.rememberRetryableSend();
      const timeoutErr = upstreamErrorLine ?? "chat run timed out";
      if (hooks.maybeScheduleIdleTimeoutRetry(timeoutErr, sendOpts)) {
        hooks.finalizeStepsOnSendError();
        useGatewayStore.setState({ lastError: null });
      } else {
        useGatewayStore.setState({ lastError: humanizeGatewayTimeoutError(timeoutErr) });
        void finalizeTaskDelivery(sessionId, replyScanSinceMs, {
          hadAssistantText: false,
          toast: false,
          cancelled: true,
          cancelReason: "timeout",
        }).catch(() => undefined);
        await hooks.persistStreamingDraftIfNeeded(replyScanSinceMs).catch(() => false);
        if (!hooks.hasDeliveredAssistantSinceLastUser()) {
          const notice = assistantTimeoutNotice(upstreamErrorLine);
          if (hooks.guardLocalAppend(notice)) {
            await hooks.appendAssistantReply(notice, replyScanSinceMs);
          }
        }
        hooks.finalizeStepsOnSendError();
      }
    } else if (finishReason === "gateway_error") {
      await hooks.persistStreamingDraftIfNeeded(replyScanSinceMs).catch(() => false);
      const rawErr = (upstreamErrorLine ?? hooks.consumeGatewayAbortError() ?? "").trim();
      const offerRetry = hooks.shouldOfferSendRetryAfterAbort?.() ?? true;
      if (offerRetry) {
        hooks.rememberRetryableSend();
        useGatewayStore.setState({
          lastError: rawErr ? humanizeAssistantRuntimeError(rawErr) : SEND_ABORT_GATEWAY_ERROR_BANNER,
        });
      } else {
        hooks.clearRetryableSend();
        useGatewayStore.setState({ lastError: null });
        const tail = hooks.getRecentAssistantText(replyScanSinceMs);
        if (tail && shouldScheduleIncompleteTurnContinue(tail) && hooks.scheduleIncompleteContinue) {
          hooks.scheduleIncompleteContinue(tail);
        }
      }
      useStepStore.getState().finalizeStaleRunningSteps("skipped");
      void finalizeTaskDelivery(sessionId, replyScanSinceMs, {
        hadAssistantText: false,
        toast: false,
        cancelled: true,
        cancelReason: "error",
      }).catch(() => undefined);
    } else if (finishReason === "disconnect") {
      hooks.settleDisconnect({ showToast: true, setBanner: true });
    } else if (finishReason === "user") {
      hooks.clearRetryableSend();
      useGatewayStore.setState({ lastError: null });
      void finalizeTaskDelivery(sessionId, replyScanSinceMs, {
        hadAssistantText: false,
        toast: false,
        cancelled: true,
        cancelReason: "user",
      }).catch(() => undefined);
      await hooks.appendStoppedNotice(replyScanSinceMs);
    } else {
      hooks.rememberRetryableSend();
      void finalizeTaskDelivery(sessionId, replyScanSinceMs, {
        hadAssistantText: false,
        toast: false,
        cancelled: true,
      }).catch(() => undefined);
      await hooks.appendStoppedNotice(replyScanSinceMs);
    }
    return;
  }

  if (reply) {
    hooks.clearPendingSendRecovery();
    hooks.clearRetryableSend();
    const assistantText = typeof reply === "string" ? reply : "";
    if (hooks.guardLocalAppend(reply)) {
      await hooks.appendAssistantReply(reply, replyScanSinceMs);
    }
    await finalizeGatewaySendSuccess({
      sessionId,
      sendId,
      localDisplay,
      replyScanSinceMs,
      assistantText,
      showSuccessToast: true,
      guardLocalAppend: hooks.guardLocalAppend,
      appendAssistantReply: hooks.appendAssistantReply,
      tryAutoTitleSession: hooks.tryAutoTitleSession,
    });
    return;
  }

  if (compactionRetryScheduled) {
    useUiStore.getState().showToast("上下文已满，已自动压缩，正在重试任务…", "info");
    hooks.finalizeStepsOnSendError();
    hooks.scheduleCompactionRetry(sendOpts?.compactionRetryAttempt ?? 0);
    return;
  }

  const errLine =
    upstreamErrorLine ??
    (await fetchAssistantErrorAfterSend(request, sessionKey, baseline));

  if (errLine && isAgentRunTimeoutError(errLine)) {
    hooks.rememberRetryableSend();
    if (hooks.maybeScheduleIdleTimeoutRetry(errLine, sendOpts)) {
      hooks.finalizeStepsOnSendError();
      useGatewayStore.setState({ lastError: null });
    } else {
      useGatewayStore.setState({ lastError: humanizeGatewayTimeoutError(errLine) });
      void finalizeTaskDelivery(sessionId, replyScanSinceMs, {
        hadAssistantText: false,
        toast: false,
        cancelled: true,
        cancelReason: "timeout",
      }).catch(() => undefined);
      await hooks.persistStreamingDraftIfNeeded(replyScanSinceMs).catch(() => false);
      if (!hooks.hasDeliveredAssistantSinceLastUser()) {
        const notice = assistantTimeoutNotice(errLine);
        if (hooks.guardLocalAppend(notice)) {
          await hooks.appendAssistantReply(notice, replyScanSinceMs);
        }
      }
      hooks.finalizeStepsOnSendError();
    }
    return;
  }

  if (errLine && isCompactionRecoveryError(errLine)) {
    const compactionAttempt = sendOpts?.compactionRetryAttempt ?? 0;
    if (compactionAttempt < 2) {
      const compacted = await tryCompactionRecoveryForSession(sessionKey);
      if (compacted) {
        useUiStore.getState().showToast("上下文已满，已自动压缩，正在重试任务…", "info");
        hooks.finalizeStepsOnSendError();
        hooks.scheduleCompactionRetry(compactionAttempt);
        return;
      }
      const displayErr = humanizeCompactionRecoveryError(errLine.replace(/^\[错误\]\s*/, ""));
      useGatewayStore.setState({ lastError: displayErr });
      if (isContextLimitError(errLine)) {
        useUiStore.getState().showToast(displayErr, "warning");
      }
      hooks.rememberRetryableSend();
      if (hooks.guardLocalAppend(errLine)) {
        await hooks.appendAssistantReply(`[错误] ${displayErr}`, replyScanSinceMs);
      }
      void finalizeTaskDelivery(sessionId, replyScanSinceMs, { hadAssistantText: false, toast: false }).catch(
        () => undefined,
      );
      hooks.finalizeStepsOnSendError();
      return;
    }
    const displayErr = humanizeCompactionRecoveryError(errLine.replace(/^\[错误\]\s*/, ""));
    useGatewayStore.setState({ lastError: displayErr });
    useUiStore.getState().showToast(displayErr, "warning");
    hooks.rememberRetryableSend();
    if (hooks.guardLocalAppend(errLine)) {
      await hooks.appendAssistantReply(`[错误] ${displayErr}`, replyScanSinceMs);
    }
    void finalizeTaskDelivery(sessionId, replyScanSinceMs, { hadAssistantText: false, toast: false }).catch(
      () => undefined,
    );
    hooks.finalizeStepsOnSendError();
    return;
  }

  if (errLine) {
    if (isMessagePresentationWarning(errLine) && hooks.hasDeliveredAssistantSinceLastUser()) {
      hooks.clearRetryableSend();
      const assistantText = hooks.getRecentAssistantText(replyScanSinceMs);
      await finalizeGatewaySendSuccess({
        sessionId,
        sendId,
        localDisplay,
        replyScanSinceMs,
        assistantText,
        showSuccessToast: false,
        guardLocalAppend: hooks.guardLocalAppend,
        appendAssistantReply: hooks.appendAssistantReply,
        tryAutoTitleSession: hooks.tryAutoTitleSession,
        scheduleIncompleteContinue: hooks.scheduleIncompleteContinue,
      });
      return;
    }
    const displayErr = humanizeGatewaySendError(errLine.replace(/^\[错误\]\s*/, ""));
    if (isRecoverableRelayKeyError(displayErr)) {
      void recoverRelayUpstreamAuth();
    } else if (isRelayUpstreamBlockedError(displayErr)) {
      useGatewayStore.setState({
        lastError:
          `上游 API 返回 403（请求被拦截）。中转站 WAF 可能拦截了 OpenAI SDK 默认 User-Agent；请更新到最新版 ${PRODUCT_NAME} 或重启应用以自动修补网关。也可运行 diagnose-relay-chat.ps1 核对。`,
      });
    } else {
      useGatewayStore.setState({ lastError: displayErr });
    }
    if (isContextLimitError(errLine)) {
      useUiStore.getState().showToast(displayErr, "warning");
    }
    hooks.rememberRetryableSend();
    if (hooks.guardLocalAppend(errLine)) {
      const userLine =
        displayErr === errLine.replace(/^\[错误\]\s*/, "") ? errLine : `[错误] ${displayErr}`;
      await hooks.appendAssistantReply(userLine, replyScanSinceMs);
    }
    void finalizeTaskDelivery(sessionId, replyScanSinceMs, { hadAssistantText: false, toast: false }).catch(
      () => undefined,
    );
    hooks.finalizeStepsOnSendError();
    return;
  }

  const delivery = await finalizeTaskDelivery(sessionId, replyScanSinceMs, {
    hadAssistantText: false,
    toast: false,
  }).catch(() => null);
  const notice =
    delivery && shouldPreferToolOnlyNotice(delivery)
      ? buildToolOnlyCompletionNotice(delivery)
      : ASSISTANT_REPLY_TIMEOUT_NOTICE;
  useGatewayStore.setState({
    lastError:
      delivery && shouldPreferToolOnlyNotice(delivery)
        ? null
        : "未收到任务正文，已在对话中写入说明。请查看右侧「任务进度」与日志。",
  });
  if (!(delivery && shouldPreferToolOnlyNotice(delivery))) {
    hooks.rememberRetryableSend();
  } else {
    hooks.clearRetryableSend();
  }
  if (hooks.guardLocalAppend(notice)) {
    await hooks.appendAssistantReply(notice, replyScanSinceMs);
  }
  hooks.finalizeStepsOnSendError();
}
