import { describe, expect, it } from "vitest";
import {
  baselineFromHistory,
  extractAssistantErrorFromMessage,
  normalizeChatHistoryMessages,
} from "./chat-history-sync";

describe("normalizeChatHistoryMessages", () => {
  it("reads top-level messages", () => {
    expect(normalizeChatHistoryMessages({ messages: [{ role: "user", content: "hi" }] })).toEqual([
      { role: "user", content: "hi" },
    ]);
  });

  it("reads nested result.messages", () => {
    expect(
      normalizeChatHistoryMessages({
        result: { messages: [{ role: "assistant", text: "ok" }] },
      }),
    ).toEqual([{ role: "assistant", text: "ok" }]);
  });
});

describe("baselineFromHistory", () => {
  it("uses normalized nested shape", () => {
    const b = baselineFromHistory({
      result: {
        messages: [
          { role: "user", content: "a" },
          { role: "assistant", text: "b" },
        ],
      },
    });
    expect(b.assistantCount).toBe(1);
    expect(b.lastAssistantText).toBe("b");
  });
});

describe("extractAssistantErrorFromMessage", () => {
  it("reads stopReason error with errorMessage", () => {
    expect(
      extractAssistantErrorFromMessage({
        role: "assistant",
        stopReason: "error",
        errorMessage: "401 Authentication Fails",
        content: [],
      }),
    ).toBe("401 Authentication Fails");
  });
});
