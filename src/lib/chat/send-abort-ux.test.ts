import { describe, expect, it } from "vitest";
import {
  hasInterruptedAssistantSinceLastUser,
  isGenericSendAbortBanner,
  shouldOfferSendRetryAfterAbort,
  collectLastAssistantTextSinceLastUser,
} from "./send-abort-ux";
import { SEND_ABORT_GATEWAY_ERROR_BANNER, SEND_ABORT_USER_BANNER } from "../openclaw/agent-run-timeout";
import { STREAMING_DRAFT_INTERRUPTED_SUFFIX } from "./persist-streaming-draft";
import type { LocalMessageRow } from "../../stores/session-store-types";

function assistant(content: string): LocalMessageRow {
  return {
    id: "a1",
    sessionId: "s1",
    role: "assistant",
    content,
    displayContent: content,
    createdAt: new Date().toISOString(),
  };
}

function user(content: string): LocalMessageRow {
  return {
    id: "u1",
    sessionId: "s1",
    role: "user",
    content,
    displayContent: content,
    createdAt: new Date().toISOString(),
  };
}

describe("send-abort-ux", () => {
  it("detects interrupted assistant tail", () => {
    const msgs = [
      user("请爬取试卷"),
      assistant(`已下载部分文件${STREAMING_DRAFT_INTERRUPTED_SUFFIX}`),
    ];
    expect(hasInterruptedAssistantSinceLastUser(msgs)).toBe(true);
    expect(shouldOfferSendRetryAfterAbort(msgs)).toBe(false);
  });

  it("offers retry when nothing was delivered", () => {
    const msgs = [user("hello")];
    expect(shouldOfferSendRetryAfterAbort(msgs)).toBe(true);
  });

  it("collects last assistant text since user", () => {
    const msgs = [
      user("请爬取试卷"),
      assistant(`部分结果${STREAMING_DRAFT_INTERRUPTED_SUFFIX}`),
    ];
    expect(collectLastAssistantTextSinceLastUser(msgs)).toContain("部分结果");
  });

  it("recognizes generic abort banners", () => {
    expect(isGenericSendAbortBanner(SEND_ABORT_GATEWAY_ERROR_BANNER)).toBe(true);
    expect(isGenericSendAbortBanner(SEND_ABORT_USER_BANNER)).toBe(true);
    expect(isGenericSendAbortBanner("Invalid API key")).toBe(false);
  });
});
