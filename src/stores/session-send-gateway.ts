import type { AssistantBaseline } from "../lib/openclaw/chat-history-sync";
import {
  fetchAssistantBaseline,
  fetchAssistantErrorAfterSend,
  pollForNewAssistantAfterSend,
} from "../lib/openclaw/chat-history-sync";
import {
  humanizeCompactionRecoveryError,
  isCompactionRecoveryError,
  prepareSessionForSend,
  tryCompactionRecoveryForSession,
} from "../lib/openclaw/compaction-recovery";
import {
  CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS,
  countCjkChars,
  estimateSessionTokensFromChars,
} from "../lib/openclaw/context-limit-policy";
import { isFatalAssistantProbeError } from "../lib/openclaw/runtime-error-policy";
import { LOCAL_ONLY_TOOL_DENY_PATTERNS, patchSessionLocalOnlyForSend } from "../lib/openclaw/local-only-policy";
import { appendOutputDirHint } from "../lib/openclaw/output-dir-hint";
import { prepareSendWithSingleHistory } from "../lib/openclaw/send-prep";
import {
  ASSISTANT_SEND_HARD_CAP_NOTICE,
  probeAssistantErrorDuringSend,
  SEND_HARD_CAP_MS,
  waitForAbortSignalWithIdleCheck,
  waitForAbortSignalWithLivenessCheck,
} from "../lib/openclaw/send-wait";
import { patchSessionModelForSend } from "../lib/openclaw/session-model";
import {
  buildSessionsSendParams,
  type SessionsSendAttachment,
  type YunTuAiSendMetadata,
} from "../lib/openclaw/session-rpc";
import {
  patchSessionThinkingForSend,
  resolveThinkingEnabledForSend,
} from "../lib/openclaw/session-thinking";
import { chatGetOutputDir } from "../lib/chat/chat-files-bridge";
import { SEND_PROGRESS } from "../lib/chat/send-progress";
import type { NativeSendDispatchMode } from "../lib/openclaw/session-native-send";
import { waitForNativeAgentRun } from "../lib/openclaw/session-native-send";
import type { LocalMessageRow } from "./sessionStore";

/** 网关 WS 等待助手回复的最长空闲时间（与 sessionStore 发送循环对齐）。 */
export const GATEWAY_WS_REPLY_WAIT_MS = 600_000;
export const GATEWAY_WS_FALLBACK_POLL_MS = 180_000;
const GATEWAY_SEND_RPC_EXTRA_MS = 60_000;

export function computeGatewaySendTimeouts(): {
  replyWaitMs: number;
  fallbackPollMs: number;
  sendTimeoutMs: number;
} {
  return {
    replyWaitMs: GATEWAY_WS_REPLY_WAIT_MS,
    fallbackPollMs: GATEWAY_WS_FALLBACK_POLL_MS,
    sendTimeoutMs:
      GATEWAY_WS_REPLY_WAIT_MS + GATEWAY_WS_FALLBACK_POLL_MS + GATEWAY_SEND_RPC_EXTRA_MS,
  };
}

export type GatewayRpcRequest = (
  method: string,
  params: Record<string, unknown>,
  reqOpts?: { timeoutMs?: number },
) => Promise<unknown>;

export type PrepareGatewaySendOpts = {
  sessionKey: string;
  rpcPayload: string;
  remotePayload: string;
  localMessages: LocalMessageRow[];
  localOnlyMode?: boolean;
  taskOrchestration: boolean;
  compactionRetryAttempt?: number;
  modelSelectionId: string;
  attachments?: SessionsSendAttachment[];
  yuntuai?: YunTuAiSendMetadata;
  request: GatewayRpcRequest;
  onProgress?: (label: string) => void;
  onCompacted?: () => void;
  onModelPatchError?: (message: string) => void;
};

export type PrepareGatewaySendOk = {
  ok: true;
  baseline: AssistantBaseline;
  rpcPayloadWithOutput: string;
  sendParams: Record<string, unknown>;
  fallbackPollMs: number;
};

export type PrepareGatewaySendBlocked = {
  ok: false;
  reason: "compaction_blocked";
  message: string;
};

export type PrepareGatewaySendResult = PrepareGatewaySendOk | PrepareGatewaySendBlocked;

/**
 * 网关发送前批量准备：历史桥接、模型/思考补丁、仅本机工具限制、上下文压缩、构造 send RPC。
 */
export async function prepareGatewaySend(
  opts: PrepareGatewaySendOpts,
): Promise<PrepareGatewaySendResult> {
  const useKey = opts.sessionKey.trim();
  const requestWithTimeout = opts.request;

  const [historyPrep, , , outDir] = await Promise.all([
    prepareSendWithSingleHistory({
      sessionKey: useKey,
      remotePayload: opts.rpcPayload,
      localMessages: opts.localMessages,
      request: requestWithTimeout,
    }),
    patchSessionModelForSend(useKey, opts.modelSelectionId).catch((e) => {
      const raw = e instanceof Error ? e.message : String(e);
      opts.onModelPatchError?.(raw);
    }),
    patchSessionThinkingForSend(useKey, resolveThinkingEnabledForSend()).catch(() => undefined),
    chatGetOutputDir().catch(() => null),
  ]);

  if (opts.localOnlyMode) {
    await patchSessionLocalOnlyForSend(useKey).catch(() => undefined);
  }

  const rpcPayloadWithOutput = appendOutputDirHint(historyPrep.bridgedPayload, outDir);

  const localChars = opts.localMessages.reduce((acc, m) => acc + m.content.length, 0);
  const localCjk = opts.localMessages.reduce((acc, m) => acc + countCjkChars(m.content), 0);
  const approxTokens = estimateSessionTokensFromChars(
    localChars + opts.remotePayload.length,
    localCjk + countCjkChars(opts.remotePayload),
  );

  if ((opts.compactionRetryAttempt ?? 0) === 0) {
    if (approxTokens >= CONTEXT_AUTOCOMPACT_THRESHOLD_TOKENS) {
      opts.onProgress?.(SEND_PROGRESS.COMPACTING_CONTEXT);
    }
    const prep = await prepareSessionForSend(useKey, approxTokens, {
      forceTaskMode: opts.taskOrchestration,
    });
    if (prep.blocked) {
      return {
        ok: false,
        reason: "compaction_blocked",
        message: humanizeCompactionRecoveryError("Auto-compaction could not recover"),
      };
    }
    if (prep.compacted) {
      opts.onCompacted?.();
    }
  }

  const { sendTimeoutMs, fallbackPollMs } = computeGatewaySendTimeouts();
  const sendParams = buildSessionsSendParams(useKey, rpcPayloadWithOutput, {
    timeoutMs: sendTimeoutMs,
    idempotencyKey: crypto.randomUUID(),
    attachments: opts.attachments,
    localOnlyMode: opts.localOnlyMode,
    toolDenylist: opts.localOnlyMode ? LOCAL_ONLY_TOOL_DENY_PATTERNS : undefined,
    yuntuai: opts.yuntuai,
  });

  return {
    ok: true,
    baseline: historyPrep.baseline,
    rpcPayloadWithOutput,
    sendParams,
    fallbackPollMs,
  };
}

export type GatewayNotifyClient = {
  notify: (method: string, params: Record<string, unknown>) => boolean;
  request: GatewayRpcRequest;
};

/** 通过 notify 或 request 提交 sessions.send（与网关订阅状态对齐）。 */
export function dispatchGatewaySessionsSend(
  client: GatewayNotifyClient,
  sendParams: Record<string, unknown>,
  eventsSubscribed: boolean,
): Promise<unknown> | null {
  if (eventsSubscribed) {
    if (!client.notify("sessions.send", sendParams)) {
      return client.request("sessions.send", sendParams);
    }
    return null;
  }
  return client.request("sessions.send", sendParams);
}

export type GatewaySendFinishReason =
  | "user"
  | "ws_complete"
  | "disconnect"
  | "timeout"
  | "gateway_error"
  | null;

export type GatewaySendReply = string | "aborted" | "ws_complete" | undefined;

export type WaitForGatewaySendReplyOpts = {
  client: GatewayNotifyClient;
  ac: AbortController;
  eventsSubscribed: boolean;
  sendRpcPromise: Promise<unknown> | null;
  sessionKey: string;
  baseline: AssistantBaseline;
  fallbackPollMs: number;
  compactionRetryAttempt?: number;
  sendMode?: NativeSendDispatchMode;
  getSendActivityMs: () => number;
  getLastAnyWsEventMs: () => number;
  consumeFinishReason: () => GatewaySendFinishReason;
  request: GatewayRpcRequest;
};

export type WaitForGatewaySendReplyResult = {
  reply: GatewaySendReply;
  baseline: AssistantBaseline;
  upstreamErrorLine?: string;
  compactionRetryScheduled: boolean;
  capturedFinishReason: GatewaySendFinishReason;
};

/** WS 等待 + 轮询兜底 + 发送期错误探针（从 sessionStore 拆出）。 */
export async function waitForGatewaySendReply(
  opts: WaitForGatewaySendReplyOpts,
): Promise<WaitForGatewaySendReplyResult> {
  const { client, ac, sessionKey, request } = opts;
  let baseline = opts.baseline;
  let upstreamErrorLine: string | undefined;
  let compactionRetryScheduled = false;
  let capturedFinishReason: GatewaySendFinishReason = null;
  let reply: GatewaySendReply;

  const hardCapAc = new AbortController();
  const onMainAbort = () => hardCapAc.abort();
  ac.signal.addEventListener("abort", onMainAbort);
  const getSendActivityMs = opts.getSendActivityMs;
  const idleHardCapWait = () =>
    waitForAbortSignalWithIdleCheck(hardCapAc.signal, SEND_HARD_CAP_MS, getSendActivityMs).then(
      (r) => (r === "timeout" ? ("hard_cap" as const) : ("aborted" as const)),
    );

  const errorProbe = probeAssistantErrorDuringSend(
    () => fetchAssistantErrorAfterSend(request, sessionKey, baseline),
    ac.signal,
  ).then(async (err) => {
    if (!err) return undefined;
    if (!isFatalAssistantProbeError(err)) return undefined;
    if (isCompactionRecoveryError(err)) {
      const compactionAttempt = opts.compactionRetryAttempt ?? 0;
      if (compactionAttempt < 2) {
        const compacted = await tryCompactionRecoveryForSession(sessionKey);
        if (compacted) {
          compactionRetryScheduled = true;
          upstreamErrorLine = err;
          ac.abort();
          return err;
        }
      }
    }
    upstreamErrorLine = err;
    ac.abort();
    return err;
  });

  if (opts.eventsSubscribed) {
    const nativeWait =
      opts.sendMode === "chat.send"
        ? waitForNativeAgentRun(request, sessionKey, GATEWAY_WS_REPLY_WAIT_MS, ac.signal).then(
            (r) => (r === "complete" ? ("native_complete" as const) : r),
          )
        : null;

    const wsWait = await Promise.race([
      waitForAbortSignalWithLivenessCheck(
        ac.signal,
        GATEWAY_WS_REPLY_WAIT_MS,
        () => Math.max(getSendActivityMs(), opts.getLastAnyWsEventMs()),
        async () => {
          try {
            await client.request("health", {}, { timeoutMs: 5_000 });
            return true;
          } catch {
            return false;
          }
        },
      ),
      idleHardCapWait(),
      ...(nativeWait ? [nativeWait] : []),
    ]);
    ac.signal.removeEventListener("abort", onMainAbort);
    await errorProbe.catch(() => undefined);
    if (wsWait === "hard_cap") {
      ac.abort();
      upstreamErrorLine = ASSISTANT_SEND_HARD_CAP_NOTICE;
      reply = undefined;
    } else if (wsWait === "aborted") {
      if (upstreamErrorLine) {
        reply = undefined;
      } else {
        capturedFinishReason = opts.consumeFinishReason();
        reply = capturedFinishReason === "ws_complete" ? "ws_complete" : "aborted";
      }
    } else if (wsWait === "native_complete") {
      capturedFinishReason = "ws_complete";
      reply = "ws_complete";
    } else {
      if (opts.sendRpcPromise) {
        await opts.sendRpcPromise.catch((e) => {
          if (!ac.signal.aborted) throw e;
        });
      }
      try {
        baseline = await fetchAssistantBaseline(request, sessionKey);
      } catch {
        /* ignore */
      }
      reply = await pollForNewAssistantAfterSend(request, sessionKey, baseline, {
        signal: ac.signal,
        timeoutMs: opts.fallbackPollMs,
        preferWs: true,
      });
    }
  } else {
    const hardCapWait = idleHardCapWait();
    await errorProbe.catch(() => undefined);
    if (!upstreamErrorLine) {
      await Promise.race([
        opts.sendRpcPromise ?? Promise.resolve(),
        hardCapWait.then((r) => {
          if (r === "hard_cap") throw new Error("__hard_cap__");
        }),
      ]).catch((e) => {
        if (e instanceof Error && e.message === "__hard_cap__") {
          upstreamErrorLine = ASSISTANT_SEND_HARD_CAP_NOTICE;
          ac.abort();
          return;
        }
        if (!ac.signal.aborted) throw e;
      });
    }
    ac.signal.removeEventListener("abort", onMainAbort);
    if (!upstreamErrorLine && !ac.signal.aborted) {
      reply = await pollForNewAssistantAfterSend(request, sessionKey, baseline, {
        signal: ac.signal,
      });
    } else {
      reply = undefined;
    }
  }

  return {
    reply,
    baseline,
    upstreamErrorLine,
    compactionRetryScheduled,
    capturedFinishReason,
  };
}
