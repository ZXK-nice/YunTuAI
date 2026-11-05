import { isAgentRunTimeoutError } from "../lib/openclaw/agent-run-timeout";

/** 当前与网关的「发消息 + 等回复」轮次（模块级单例）。 */
export type ActiveSendHandle = {
  controller: AbortController;
  sessionKey: string;
  sendStartedAtMs: number;
  lastWsEventAt: number;
};

export type ActiveSendFinishReason =
  | "user"
  | "ws_complete"
  | "disconnect"
  | "timeout"
  | "gateway_error"
  | null;

let activeSendHandle: ActiveSendHandle | null = null;
let activeSendFinishReason: ActiveSendFinishReason = null;
let lastGatewayAbortError: string | null = null;

let activeSendSettlement: { promise: Promise<void>; resolve: () => void } | null = null;

function sessionKeysMatch(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  return x === y || x.toLowerCase() === y.toLowerCase();
}

export function resetActiveSendFinishReason(): void {
  activeSendFinishReason = null;
  lastGatewayAbortError = null;
}

export function consumeLastGatewayAbortError(): string | null {
  const e = lastGatewayAbortError;
  lastGatewayAbortError = null;
  return e;
}

export function consumeActiveSendFinishReason(): Exclude<ActiveSendFinishReason, null> | null {
  const reason = activeSendFinishReason;
  activeSendFinishReason = null;
  return reason;
}

export function getActiveSendHandle(): ActiveSendHandle | null {
  return activeSendHandle;
}

export function setActiveSendHandle(handle: ActiveSendHandle): void {
  activeSendHandle = handle;
}

export function clearActiveSendHandle(controller?: AbortController): void {
  if (!controller || activeSendHandle?.controller === controller) {
    activeSendHandle = null;
  }
}

export function clearActiveSendState(): void {
  activeSendHandle = null;
  resetActiveSendFinishReason();
}

export function touchActiveSendWsEvent(sessionKey: string): void {
  const h = activeSendHandle;
  if (!h || h.controller.signal.aborted) return;
  if (!sessionKeysMatch(h.sessionKey, sessionKey)) return;
  h.lastWsEventAt = Date.now();
}

export function abortActiveSendForGatewayError(sessionKey: string, errorMessage?: string): void {
  const h = activeSendHandle;
  if (!h?.controller || h.controller.signal.aborted) return;
  if (!sessionKeysMatch(h.sessionKey, sessionKey)) return;
  const msg = errorMessage?.trim() ?? "";
  lastGatewayAbortError = msg || null;
  activeSendFinishReason = isAgentRunTimeoutError(msg) ? "timeout" : "gateway_error";
  h.controller.abort();
}

export function markActiveSendWsComplete(sessionKey: string): boolean {
  const h = activeSendHandle;
  if (!h?.controller || h.controller.signal.aborted) return false;
  if (!sessionKeysMatch(h.sessionKey, sessionKey)) return false;
  activeSendFinishReason = "ws_complete";
  h.controller.abort();
  return true;
}

export function markActiveSendUserAbort(): void {
  const h = activeSendHandle;
  if (!h?.controller || h.controller.signal.aborted) return;
  activeSendFinishReason = "user";
  h.controller.abort();
}

export function markActiveSendDisconnectAbort(): void {
  const h = activeSendHandle;
  if (!h?.controller || h.controller.signal.aborted) return;
  activeSendFinishReason = "disconnect";
  h.controller.abort();
}

export function beginActiveSendSettlement(): void {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  activeSendSettlement = { promise, resolve };
}

export function endActiveSendSettlement(): void {
  activeSendSettlement?.resolve();
  activeSendSettlement = null;
}

export async function awaitActiveSendSettlement(timeoutMs = 30_000): Promise<void> {
  const cur = activeSendSettlement;
  if (!cur) return;
  await Promise.race([
    cur.promise,
    new Promise<void>((r) => window.setTimeout(r, timeoutMs)),
  ]);
}
