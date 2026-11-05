/**
 * OpenClaw 原生发送路径：`chat.send` + `agent.wait`，不可用时回退 `sessions.send`。
 */
import { extractGatewayMethodsList } from "./gateway-method-coverage";
import { adaptSendParamsForGatewayMethod } from "./session-rpc";
import type { GatewayRpcRequest, GatewayNotifyClient } from "../../stores/session-send-gateway";

export type NativeSendDispatchMode = "chat.send" | "sessions.send";

let cachedNativeSendSupported: boolean | null = null;
let cacheAtMs = 0;
const CAPABILITY_CACHE_MS = 120_000;

export function resetNativeSendCapabilityCache(): void {
  cachedNativeSendSupported = null;
  cacheAtMs = 0;
}

export function gatewayMethodsSupportNativeChatSend(methods: string[]): boolean {
  return methods.includes("chat.send") && methods.includes("agent.wait");
}

export async function probeNativeChatSendSupported(
  request: GatewayRpcRequest,
): Promise<boolean> {
  if (cachedNativeSendSupported !== null && Date.now() - cacheAtMs < CAPABILITY_CACHE_MS) {
    return cachedNativeSendSupported;
  }
  try {
    const raw = await request("list_methods", {}, { timeoutMs: 3_000 });
    const methods = extractGatewayMethodsList(raw);
    cachedNativeSendSupported = gatewayMethodsSupportNativeChatSend(methods);
  } catch {
    cachedNativeSendSupported = false;
  }
  cacheAtMs = Date.now();
  return cachedNativeSendSupported;
}

export type DispatchGatewayChatSendResult = {
  mode: NativeSendDispatchMode;
  sendRpcPromise: Promise<unknown> | null;
};

function dispatchByMethod(
  client: GatewayNotifyClient,
  method: NativeSendDispatchMode,
  sendParams: Record<string, unknown>,
): DispatchGatewayChatSendResult {
  // 发送必须走 request 并等待 RPC 应答；notify 会丢弃网关返回的错误帧，导致「整理回答中」无限挂起。
  return { mode: method, sendRpcPromise: client.request(method, sendParams) };
}

/**
 * 网关支持且已订阅事件时优先 `chat.send`，否则沿用 `sessions.send`。
 */
export async function dispatchGatewayChatSend(
  client: GatewayNotifyClient,
  sendParams: Record<string, unknown>,
  eventsSubscribed: boolean,
  opts?: {
    preferNative?: boolean;
    request?: GatewayRpcRequest;
  },
): Promise<DispatchGatewayChatSendResult> {
  const preferNative = opts?.preferNative !== false;
  let mode: NativeSendDispatchMode = "sessions.send";

  if (preferNative && eventsSubscribed && opts?.request) {
    const supported = await probeNativeChatSendSupported(opts.request);
    if (supported) mode = "chat.send";
  }

  return dispatchByMethod(client, mode, adaptSendParamsForGatewayMethod(mode, sendParams));
}

export type NativeAgentWaitResult = "complete" | "timeout" | "aborted";

/** 等待当前会话 agent run 结束（`agent.wait`）。 */
export async function waitForNativeAgentRun(
  request: GatewayRpcRequest,
  sessionKey: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<NativeAgentWaitResult> {
  if (signal.aborted) return "aborted";
  const key = sessionKey.trim();
  if (!key) return "timeout";
  try {
    await request(
      "agent.wait",
      { key, sessionKey: key, timeoutMs },
      { timeoutMs: timeoutMs + 10_000 },
    );
    return signal.aborted ? "aborted" : "complete";
  } catch {
    return signal.aborted ? "aborted" : "timeout";
  }
}
