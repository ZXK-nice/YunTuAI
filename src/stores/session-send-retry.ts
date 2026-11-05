import {
  ASSISTANT_DISCONNECT_NOTICE,
  humanizeGatewayTimeoutError,
} from "../lib/openclaw/agent-run-timeout";
import {
  humanizeGatewaySendError,
  isRecoverableRelayKeyError,
  isRelayUpstreamBlockedError,
  isSessionFileLockedError,
  isTransientGatewaySendError,
} from "../lib/openclaw/connection-resilience";
import { recoverRelayUpstreamAuth } from "../lib/openclaw/relay-auth-recovery";
import { PRODUCT_NAME } from "../lib/product-brand";
import { useGatewayStore } from "./gatewayStore";
import { useUiStore } from "./uiStore";
import type { GatewaySendFinishReason } from "./session-send-gateway";

export type GatewaySendRetryHooks = {
  guardLocalAppend: (content: string) => boolean;
  appendAssistantReply: (content: string, sinceMs: number) => Promise<void>;
  finalizeStepsOnSendError: () => void;
  rememberRetryableSend: () => void;
  clearRetryableSend: () => void;
  clearPendingSendRecovery: () => void;
  consumeGatewayAbortError: () => string | null;
  consumeFinishReason: () => GatewaySendFinishReason;
  settleDisconnect: (opts?: { showToast?: boolean; setBanner?: boolean }) => void;
  appendStoppedNotice: (sinceMs: number) => Promise<void>;
  maybeScheduleIdleTimeoutRetry: (
    rawErr: string,
    extra?: { idleRetryAttempt?: number },
  ) => boolean;
  scheduleAutoRetry: (delayMs: number, nextAttempt: number) => void;
  shouldOfferSendRetry?: () => boolean;
};

export type HandleGatewaySendCatchOpts = {
  error: unknown;
  signalAborted: boolean;
  capturedFinishReason: GatewaySendFinishReason;
  replyScanSinceMs: number;
  sendOpts?: { autoRetryAttempt?: number; idleRetryAttempt?: number };
  hooks: GatewaySendRetryHooks;
};

function formatSendFailureLine(displayErr: string): string {
  return (
    `【发送或服务异常】${displayErr}\n\n` +
    "请尝试在「配置」中断开并重连服务，或查看右侧「任务进度」与日志。若仅为临时网络问题，可稍后重试。"
  );
}

/** 处理 sendMessage 网关轮次 catch：abort 收尾与瞬断/relay 自动重试。 */
export async function handleGatewaySendCatch(opts: HandleGatewaySendCatchOpts): Promise<void> {
  const { hooks, replyScanSinceMs, sendOpts } = opts;

  if (opts.signalAborted) {
    const finish = opts.capturedFinishReason ?? hooks.consumeFinishReason();
    if (finish === "timeout") {
      hooks.rememberRetryableSend();
      const timeoutErr = hooks.consumeGatewayAbortError() ?? "chat run timed out";
      if (!hooks.maybeScheduleIdleTimeoutRetry(timeoutErr, sendOpts)) {
        useGatewayStore.setState({
          lastError: humanizeGatewayTimeoutError(timeoutErr),
        });
      } else {
        useGatewayStore.setState({ lastError: null });
      }
    } else if (finish === "disconnect") {
      hooks.settleDisconnect({ showToast: false, setBanner: true });
      if (hooks.guardLocalAppend(ASSISTANT_DISCONNECT_NOTICE)) {
        await hooks.appendAssistantReply(ASSISTANT_DISCONNECT_NOTICE, replyScanSinceMs);
      }
    } else if (finish === "user") {
      hooks.clearRetryableSend();
      hooks.clearPendingSendRecovery();
    } else if ((hooks.shouldOfferSendRetry?.() ?? true) === true) {
      hooks.rememberRetryableSend();
    } else {
      hooks.clearRetryableSend();
      useGatewayStore.setState({ lastError: null });
    }
    hooks.finalizeStepsOnSendError();
    if (finish === "user") {
      await hooks.appendStoppedNotice(replyScanSinceMs);
    }
    return;
  }

  const raw = opts.error instanceof Error ? opts.error.message : String(opts.error);
  const displayErr = humanizeGatewaySendError(raw);
  const attempt = sendOpts?.autoRetryAttempt ?? 0;
  const retryableTransient =
    isTransientGatewaySendError(raw) || isSessionFileLockedError(raw);

  if (
    retryableTransient &&
    attempt < 2 &&
    useGatewayStore.getState().connState === "connected"
  ) {
    useGatewayStore.setState({ lastError: null });
    useUiStore.getState().showToast(
      isSessionFileLockedError(raw)
        ? "会话正被占用，正在自动重试…"
        : "连接短暂中断，正在自动重试…",
      "info",
    );
    const delayMs = isSessionFileLockedError(raw) ? 2_000 : 500 + attempt * 400;
    hooks.scheduleAutoRetry(delayMs, attempt + 1);
    return;
  }

  if (isRecoverableRelayKeyError(raw)) {
    void recoverRelayUpstreamAuth();
    hooks.rememberRetryableSend();
    const errLine = formatSendFailureLine(displayErr);
    if (hooks.guardLocalAppend(errLine)) {
      await hooks.appendAssistantReply(errLine, replyScanSinceMs);
    }
    hooks.finalizeStepsOnSendError();
    return;
  }

  if (isRelayUpstreamBlockedError(raw)) {
    useGatewayStore.setState({
      lastError:
        `上游 API 返回 403（请求被拦截）。多为中转站 WAF 拦截 OpenAI SDK 默认 User-Agent；请更新 ${PRODUCT_NAME} 或重启应用。`,
    });
    hooks.rememberRetryableSend();
    const errLine = formatSendFailureLine(displayErr);
    if (hooks.guardLocalAppend(errLine)) {
      await hooks.appendAssistantReply(errLine, replyScanSinceMs);
    }
    hooks.finalizeStepsOnSendError();
    return;
  }

  useGatewayStore.setState({ lastError: displayErr });
  hooks.rememberRetryableSend();
  const errLine = formatSendFailureLine(displayErr);
  if (hooks.guardLocalAppend(errLine)) {
    await hooks.appendAssistantReply(errLine, replyScanSinceMs);
  }
  hooks.finalizeStepsOnSendError();
}
