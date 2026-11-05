/**
 * 前后端（WebView ↔ 本机 OpenClaw 网关）连接韧性：退避、限流识别、凭据重试。
 */
import type { GatewaySupervisorStatus } from "./cli-bridge";
import { humanizeContextLimitError, isContextLimitError } from "./context-limit-policy";
import { humanizeAssistantRuntimeError } from "./runtime-error-policy";
import { humanizeGatewayTimeoutError, isAgentRunTimeoutError } from "./agent-run-timeout";

/**
 * 监管网关是否可用于 WebSocket 连接。
 * HTTP health 在推理高峰可能短暂失败，但 TCP/WS 仍可用；勿因 healthOk=false 反复杀活网关。
 */
export function isSupervisorGatewayOperational(
  st: GatewaySupervisorStatus | null | undefined,
  opts?: { requireHealthOk?: boolean },
): boolean {
  if (!st?.supervised || !st.running) return false;
  if (opts?.requireHealthOk) return st.healthOk;
  return true;
}

/** 网关因连续认证失败触发的短时封禁（OpenClaw reason=rate_limited）。 */
export function isGatewayRateLimitedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("rate_limited") ||
    m.includes("too many failed authentication") ||
    m.includes("retry later")
  );
}

export function isGatewayAuthError(message: string): boolean {
  if (isGatewayRateLimitedError(message)) return false;
  return /token.?mismatch|auth_token_mismatch|unauthorized|token_missing|auth_token_missing/i.test(
    message,
  );
}

/** 上游 WAF / IP 拦截（403 blocked）；重启网关无法修复，勿触发自动 resync。 */
export function isRelayUpstreamBlockedError(message: string): boolean {
  return /your request was blocked/i.test(message);
}

/** 上游 LLM / 中转 API 鉴权失败（可尝试同步内嵌 Key）。 */
export function isUpstreamLlmAuthError(message: string): boolean {
  const m = message.toLowerCase();
  if (isRelayUpstreamBlockedError(message)) return true;
  if (/\b403\b/.test(m) && /blocked|forbidden|denied|auth|key|token/.test(m)) return true;
  if (/\b401\b/.test(m) && /invalid|unauthorized|auth|token|key/.test(m)) return true;
  return (
    /invalid(?:\s+\w+){0,3}\s+(?:api[_ -]?key|token)/.test(m) ||
    /(?:api[_ -]?key|token).{0,24}invalid/.test(m) ||
    /authentication failed|access denied|forbidden by upstream/.test(m)
  );
}

/** 仅密钥类错误才自动 resync + 重启网关；403 blocked 多为 IP/WAF，重启只会断连。 */
export function isRecoverableRelayKeyError(message: string): boolean {
  if (isRelayUpstreamBlockedError(message)) return false;
  const m = message.toLowerCase();
  if (/\b401\b/.test(m)) return true;
  return (
    /invalid(?:\s+\w+){0,3}\s+(?:api[_ -]?key|token)/.test(m) ||
    /(?:api[_ -]?key|token).{0,24}invalid/.test(m) ||
    /authentication failed|invalid token/.test(m)
  );
}

/**
 * 发送阶段短暂网络/WS 故障：可自动重试一次。
 * 排除鉴权、限流、WAF、上游密钥类错误，避免无效重试。
 */
export function isTransientGatewaySendError(message: string): boolean {
  if (!message.trim()) return false;
  if (isGatewayAuthError(message)) return false;
  if (isGatewayRateLimitedError(message)) return false;
  if (isRelayUpstreamBlockedError(message)) return false;
  if (isRecoverableRelayKeyError(message)) return false;
  const m = message.toLowerCase();
  return (
    /websocket|ws\b|econnreset|econnrefused|etimedout|network|socket|connection (?:closed|reset|refused)|failed to fetch|fetch failed|temporarily unavailable|service unavailable|\b502\b|\b503\b|\b504\b|broken pipe|i\/o timeout|timed?\s*out|session file locked|\.jsonl\.lock/.test(
      m,
    )
  );
}

/** 网关会话 transcript 被锁（`.jsonl.lock`）时的用户提示。 */
export const SESSION_FILE_LOCKED_HINT =
  "当前会话正被占用（可能仍有任务在读写该会话）。建议：等待数秒后重试；或新建对话；若长时间无响应，请到「软件设置 → 本机服务」重启本机服务。";

export function isSessionFileLockedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("session file locked") ||
    m.includes(".jsonl.lock") ||
    (m.includes("jsonl") && m.includes("locked"))
  );
}

/** 将网关发送/办事错误转为用户可读文案（保留未识别原文）。 */
export function humanizeGatewaySendError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  if (isAgentRunTimeoutError(trimmed)) return humanizeGatewayTimeoutError(trimmed);
  if (isSessionFileLockedError(trimmed)) return SESSION_FILE_LOCKED_HINT;
  const friendly = humanizeAssistantRuntimeError(trimmed);
  if (isContextLimitError(friendly)) return humanizeContextLimitError(friendly);
  return friendly;
}

/** 连接失败后的建议重连等待（毫秒）；非限流返回 null，由常规退避处理。 */
export function connectFailureReconnectDelayMs(message: string, reconnectAttempt = 0): number | null {
  if (!isGatewayRateLimitedError(message)) return null;
  const base = 35_000;
  const scaled = base * Math.pow(1.35, Math.min(reconnectAttempt, 4));
  return Math.min(120_000, Math.round(scaled + jitterMs(scaled * 0.12)));
}

function jitterMs(max: number): number {
  if (max <= 0) return 0;
  return Math.floor(Math.random() * max);
}

/** 自动重连退避（含抖动，避免多客户端同步风暴）。 */
export function reconnectBackoffMs(attempt: number, opts?: { rateLimited?: boolean }): number {
  if (opts?.rateLimited) {
    const base = 30_000 * Math.pow(1.4, Math.min(attempt, 3));
    return Math.min(90_000, Math.round(base + jitterMs(base * 0.1)));
  }
  const base = 500 * Math.pow(1.8, Math.min(attempt, 4));
  return Math.min(10_000, Math.round(base + jitterMs(base * 0.15)));
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带间隔重试；末次失败返回 null。 */
export async function withInvokeRetries<T>(
  fn: () => Promise<T | null>,
  opts?: { attempts?: number; baseDelayMs?: number },
): Promise<T | null> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 180;
  for (let i = 0; i < attempts; i++) {
    const v = await fn().catch(() => null);
    if (v != null) return v;
    if (i < attempts - 1) await sleepMs(baseDelayMs * (i + 1));
  }
  return null;
}
