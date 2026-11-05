/**
 * 办事运行时错误分级：区分「可自愈的工具失败」与「必须中断的致命错误」。
 * 避免 Edit/Write 中途失败就整轮 abort，或把英文工具报错写入聊天气泡。
 */

import { isCompactionRecoveryError } from "./compaction-recovery";
import { isAgentRunTimeoutError, humanizeGatewayTimeoutError } from "./agent-run-timeout";
import { isContextLimitError } from "./context-limit-policy";
import {
  isGatewayAuthError,
  isGatewayRateLimitedError,
  isRecoverableRelayKeyError,
  isRelayUpstreamBlockedError,
  isSessionFileLockedError,
} from "./connection-resilience";
import { sanitizeUserFacingCopy } from "../product-copy";

const UNKNOWN_RUNTIME_ERROR =
  "本轮任务未能完成。已尽量保留已输出内容；可点「重试」或发送「继续」。";

function looksLikeRawRuntimeDump(body: string): boolean {
  if (/openclaw|econn|enoent|failed to|error:|stack\b|at \w+\(/i.test(body)) return true;
  if (/[A-Za-z]{12,}/.test(body) && !/[\u4e00-\u9fff]/.test(body)) return true;
  return false;
}

const TOOL_ERROR_RE =
  /(?:^|\n)\s*(?:\[错误\]\s*)?(?:⚠️\s*)?(?:📝\s*)?(?:Edit|Write|Read|Bash|Exec|ApplyPatch|Shell):\s*.+failed/i;

const TRANSIENT_NETWORK_RE =
  /\b(econnreset|econnrefused|etimedout|enotfound|socket hang up|network error|fetch failed|connection reset|broken pipe)\b/i;

/** OpenClaw 投递/展示警告：模型已产出正文时不必写入错误气泡或中断轮次。 */
const MESSAGE_PRESENTATION_WARNING_RE =
  /(?:^|\n)\s*(?:\[错误\]\s*)?(?:⚠️\s*)?(?:✉️\s*)?Message failed/i;

export function isMessagePresentationWarning(message: string): boolean {
  const body = message.replace(/^\[错误\]\s*/, "").trim();
  if (!body) return false;
  return MESSAGE_PRESENTATION_WARNING_RE.test(body);
}

/** 短暂网络抖动：保持等待，交给重连/探活恢复，勿整轮 abort。 */
export function isTransientNetworkError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return TRANSIENT_NETWORK_RE.test(m);
}

/** Agent 工具中途失败，通常会在同轮内重试或换路径，不应中断用户等待。 */
export function isRecoverableAgentToolError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (TOOL_ERROR_RE.test(m)) return true;
  const lower = m.toLowerCase();
  if (lower.includes(" failed") && /edit:|write:|read:|bash:|exec:|shell:|applypatch:/.test(lower)) {
    return true;
  }
  if (/\b(enotfound|enoent|eacces|ebusy|eperm)\b/.test(lower)) return true;
  if (lower.includes("file is locked") || lower.includes(".jsonl.lock")) return true;
  // OpenClaw 常见中途工具失败文案：不应整轮 abort
  if (/\btool(?:\s+call)?\s+(?:failed|error)\b/i.test(m) && !/\bapi[_ -]?key\b/i.test(lower)) {
    return true;
  }
  if (/command failed|spawn .*enoent|no such file or directory/i.test(m)) return true;
  return false;
}

/** 网关 error 事件是否应中止本地等待轮次（可自愈工具失败不应中止）。 */
export function shouldAbortSendOnGatewayChatError(
  message: string,
  opts?: { hasDeliverableInTurn?: boolean },
): boolean {
  const body = message.replace(/^\[错误\]\s*/, "").trim();
  if (!body) return opts?.hasDeliverableInTurn !== true;
  if (isMessagePresentationWarning(body) || isMessagePresentationWarning(message)) {
    return opts?.hasDeliverableInTurn !== true;
  }
  if (isRecoverableAgentToolError(body) || isRecoverableAgentToolError(message)) return false;
  if (isSessionFileLockedError(body)) return false;
  if (isTransientNetworkError(body) || isTransientNetworkError(message)) return false;
  return true;
}

/** 发送中 history 探针：仅致命错误才提前 abort。 */
export function isFatalAssistantProbeError(message: string): boolean {
  const body = message.replace(/^\[错误\]\s*/, "").trim();
  if (!body) return false;
  if (isMessagePresentationWarning(body) || isMessagePresentationWarning(message)) return false;
  if (isRecoverableAgentToolError(body) || isRecoverableAgentToolError(message)) return false;
  if (isCompactionRecoveryError(body)) return true;
  if (isAgentRunTimeoutError(body)) return true;
  if (isContextLimitError(body)) return true;
  if (isSessionFileLockedError(body)) return false;
  if (isTransientNetworkError(body) || isTransientNetworkError(message)) return false;
  if (isGatewayAuthError(body) || isGatewayRateLimitedError(body)) return true;
  if (isRecoverableRelayKeyError(body) || isRelayUpstreamBlockedError(body)) return true;
  if (/invalid(?:\s+\w+){0,3}\s+(?:api[_ -]?key|token)/i.test(body)) return true;
  if (/\b401\b|\b403\b/.test(body) && /auth|key|token|blocked/i.test(body)) return true;
  return true;
}

/** 将助手/工具运行时错误转为用户可读文案。 */
export function humanizeAssistantRuntimeError(message: string): string {
  const body = message.replace(/^\[错误\]\s*/, "").trim();
  if (!body) return message;
  if (isCompactionRecoveryError(body)) {
    return "对话上下文过长，自动压缩未能完成。建议压缩上下文或新建对话后继续长任务。";
  }
  if (isAgentRunTimeoutError(body)) {
    return humanizeGatewayTimeoutError(body);
  }
  if (isSessionFileLockedError(body)) {
    return "当前会话正被占用，请稍等几秒后重试，或新建对话。";
  }
  if (/insufficient[_\s-]*balance|余额不足|\b402\b/i.test(body)) {
    return "当前模型账户余额不足。请到该厂商控制台充值，或改用其他已有额度的模型。模型名称和通道没有配错。";
  }
  if (/\b429\b|rate limit|too many requests/i.test(body)) {
    return "模型服务请求过于频繁，请稍后再试。";
  }
  if (/invalid api key|incorrect api key|authentication fails|\b401\b/i.test(body)) {
    return "模型 API Key 无效或未授权。请到设置中检查该厂商的密钥。";
  }
  const unsupported =
    body.match(/unsupported model\s+([^\s,"]+)/i)?.[1] ??
    body.match(/you passed\s+([^\s."]+)/i)?.[1];
  if (unsupported || /supported api model names are/i.test(body)) {
    return unsupported
      ? `接口不接受模型「${unsupported}」。请改选列表中的模型，或在设置中填写接口模型 ID（例如 mimo-v2.6-pro）。`
      : "接口不接受当前模型名。请改选列表中的模型，或填写接口模型 ID。";
  }
  if (isRecoverableAgentToolError(body)) {
    if (/edit:/i.test(body)) {
      return "文件编辑未成功（可能路径不存在或文件被占用），Agent 通常会自行重试或换用写入方式。";
    }
    if (/write:/i.test(body)) {
      return "文件写入未成功，Agent 通常会自行重试。";
    }
    return "工具步骤未成功，助手通常会自行重试或调整方案。";
  }
  if (looksLikeRawRuntimeDump(body)) {
    return UNKNOWN_RUNTIME_ERROR;
  }
  return sanitizeUserFacingCopy(body);
}

/** 是否应将错误写入聊天气泡（进行中的可自愈工具错误仅记日志/任务面板）。 */
export function shouldPersistAssistantErrorBubble(
  message: string,
  opts?: { sendStillActive?: boolean; hasDeliverableInTurn?: boolean },
): boolean {
  const body = message.replace(/^\[错误\]\s*/, "").trim();
  if (!body) return false;
  if (isCompactionRecoveryError(body)) return false;
  if (isMessagePresentationWarning(body) && opts?.hasDeliverableInTurn) return false;
  if (opts?.sendStillActive && isRecoverableAgentToolError(body)) return false;
  return true;
}
