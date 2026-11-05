import { describe, expect, it } from "vitest";
import {
  buildPersistedStreamingDraftContent,
  hasDeliveredAssistantSinceLastUser,
  isDeliveredAssistantContent,
} from "./persist-streaming-draft";
import { ASSISTANT_STOPPED_NOTICE } from "../openclaw/send-wait";
import type { LocalMessageRow } from "../../stores/sessionStore";

function msg(role: string, content: string): LocalMessageRow {
  return {
    id: "1",
    sessionId: "s1",
    role,
    content,
    createdAt: "1",
  };
}

describe("persist-streaming-draft", () => {
  it("treats system notices as non-delivered content", () => {
    expect(isDeliveredAssistantContent(ASSISTANT_STOPPED_NOTICE)).toBe(false);
    expect(isDeliveredAssistantContent("这是一段正常回复")).toBe(true);
  });

  it("detects delivered assistant after last user message", () => {
    const messages = [
      msg("user", "写手册"),
      msg("assistant", "第一章内容"),
    ];
    expect(hasDeliveredAssistantSinceLastUser(messages)).toBe(true);
  });

  it("ignores stopped notice when checking delivery", () => {
    const messages = [msg("user", "写手册"), msg("assistant", ASSISTANT_STOPPED_NOTICE)];
    expect(hasDeliveredAssistantSinceLastUser(messages)).toBe(false);
  });

  it("appends interrupted suffix for plain draft", () => {
    const out = buildPersistedStreamingDraftContent("第一段内容");
    expect(out).toContain("第一段内容");
    expect(out).toContain("【生成已中断");
  });

  it("does not duplicate suffix for paused draft", () => {
    const paused = "part 1\n[PAUSED — 1 of 3 complete. Send \"continue\"]";
    expect(buildPersistedStreamingDraftContent(paused)).toBe(paused);
  });
});
