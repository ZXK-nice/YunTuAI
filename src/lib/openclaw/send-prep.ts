/**
 * 发送前单次 chat.history：同时产出 assistant 基线与接续注入，避免重复 RPC。
 */
import type { LocalMessageRow } from "../../stores/sessionStore";
import {
  baselineFromHistory,
  type AssistantBaseline,
} from "./chat-history-sync";
import { bridgePayloadWithGatewayHistory } from "./session-context-bridge";

export type SendHistoryPrep = {
  baseline: AssistantBaseline;
  bridgedPayload: string;
};

export async function prepareSendWithSingleHistory(opts: {
  sessionKey: string;
  remotePayload: string;
  localMessages: LocalMessageRow[];
  request: (
    method: string,
    params: Record<string, unknown>,
    reqOpts?: { timeoutMs?: number },
  ) => Promise<unknown>;
}): Promise<SendHistoryPrep> {
  const sessionKey = opts.sessionKey.trim();
  const payload = opts.remotePayload;
  const empty = baselineFromHistory({});

  if (!sessionKey) {
    return { baseline: empty, bridgedPayload: payload };
  }

  let raw: unknown = null;
  try {
    raw = await opts.request(
      "chat.history",
      { sessionKey, limit: 400 },
      { timeoutMs: 45_000 },
    );
  } catch {
    return { baseline: empty, bridgedPayload: payload };
  }

  return {
    baseline: baselineFromHistory(raw),
    bridgedPayload: bridgePayloadWithGatewayHistory(raw, opts.localMessages, payload),
  };
}
