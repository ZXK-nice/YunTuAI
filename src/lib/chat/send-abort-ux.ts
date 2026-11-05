import {
  SEND_ABORT_DISCONNECT_BANNER,
  SEND_ABORT_GATEWAY_ERROR_BANNER,
  SEND_ABORT_USER_BANNER,
} from "../openclaw/agent-run-timeout";
import type { LocalMessageRow } from "../../stores/session-store-types";
import { isInterruptedAssistantContent } from "./context-cards";
import { hasDeliveredAssistantSinceLastUser } from "./persist-streaming-draft";

export function hasInterruptedAssistantSinceLastUser(messages: readonly LocalMessageRow[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) break;
    const role = message.role.trim().toLowerCase();
    if (role === "user" || role === "human") break;
    if ((role === "assistant" || role === "model") && isInterruptedAssistantContent(message.content)) {
      return true;
    }
  }
  return false;
}

/** 中断后是否展示「重试发送」；已有落库正文或断点续写提示时优先「继续」。 */
export function shouldOfferSendRetryAfterAbort(messages: readonly LocalMessageRow[]): boolean {
  if (hasInterruptedAssistantSinceLastUser(messages)) return false;
  if (hasDeliveredAssistantSinceLastUser(messages)) return false;
  return true;
}

export function isGenericSendAbortBanner(message: string | null | undefined): boolean {
  const m = message?.trim() ?? "";
  if (!m) return false;
  return (
    m === SEND_ABORT_GATEWAY_ERROR_BANNER ||
    m === SEND_ABORT_DISCONNECT_BANNER ||
    m === SEND_ABORT_USER_BANNER
  );
}

export function collectLastAssistantTextSinceLastUser(messages: readonly LocalMessageRow[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) break;
    const role = message.role.trim().toLowerCase();
    if (role === "user" || role === "human") break;
    if (role === "assistant" || role === "model") {
      return (message.content ?? "").trim();
    }
  }
  return "";
}
