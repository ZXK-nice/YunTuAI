import { describe, expect, it, vi } from "vitest";
import type { LocalMessageRow } from "../../stores/sessionStore";
import { prepareSendWithSingleHistory } from "./send-prep";
import { SESSION_CONTEXT_BRIDGE_MARKER } from "./session-context-bridge";

function userMsg(id: string, content: string): LocalMessageRow {
  return {
    id,
    sessionId: "s1",
    role: "user",
    content,
    createdAt: "1",
  };
}

describe("prepareSendWithSingleHistory", () => {
  it("单次 chat.history 同时产出 baseline 与接续 payload", async () => {
    const request = vi.fn(async () => ({
      messages: [
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧答", text: "旧答" },
      ],
    }));

    const local = [userMsg("u1", "旧问题"), userMsg("u2", "新问题")];

    const prep = await prepareSendWithSingleHistory({
      sessionKey: "sk",
      remotePayload: "新问题",
      localMessages: local,
      request,
    });

    expect(request).toHaveBeenCalledWith(
      "chat.history",
      { sessionKey: "sk", limit: 400 },
      { timeoutMs: 45_000 },
    );
    expect(prep.baseline.assistantCount).toBe(1);
    expect(prep.bridgedPayload).toContain(SESSION_CONTEXT_BRIDGE_MARKER);
  });

  it("history 失败时回退为空 baseline", async () => {
    const prep = await prepareSendWithSingleHistory({
      sessionKey: "sk",
      remotePayload: "hello",
      localMessages: [],
      request: vi.fn(async () => {
        throw new Error("fail");
      }),
    });
    expect(prep.baseline.assistantCount).toBe(0);
    expect(prep.bridgedPayload).toBe("hello");
  });
});
