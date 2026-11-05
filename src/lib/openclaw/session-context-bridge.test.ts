import { describe, expect, it, vi } from "vitest";
import type { LocalMessageRow } from "../../stores/sessionStore";
import {
  bridgePayloadWithGatewayHistory,
  maybeInjectSessionContextBridge,
  SESSION_CONTEXT_BRIDGE_MARKER,
} from "./session-context-bridge";

function userMsg(id: string, content: string): LocalMessageRow {
  return {
    id,
    sessionId: "s1",
    role: "user",
    content,
    createdAt: String(Date.now()),
  };
}

function assistantMsg(id: string, content: string): LocalMessageRow {
  return {
    id,
    sessionId: "s1",
    role: "assistant",
    content,
    createdAt: String(Date.now()),
  };
}

describe("maybeInjectSessionContextBridge", () => {
  it("不注入：网关与本地 user 轮次一致", async () => {
    const local = [
      userMsg("u1", "你好"),
      assistantMsg("a1", "你好呀"),
      userMsg("u2", "继续"),
    ];
    const request = vi.fn(async () => ({
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好呀" },
        { role: "user", content: "继续" },
      ],
    }));

    const out = await maybeInjectSessionContextBridge({
      sessionKey: "sk",
      remotePayload: "第三条",
      localMessages: local,
      request,
    });
    expect(out).toBe("第三条");
  });

  it("注入：仅 1 轮本地 user 未同步到网关也应接续", async () => {
    const local = [
      userMsg("u1", "昨天的问题 A"),
      assistantMsg("a1", "回答 A"),
      userMsg("u2", "今天继续"),
    ];
    const request = vi.fn(async () => ({
      messages: [
        { role: "user", content: "昨天的问题 A" },
        { role: "assistant", content: "回答 A" },
      ],
    }));

    const out = await maybeInjectSessionContextBridge({
      sessionKey: "sk",
      remotePayload: "今天继续",
      localMessages: local,
      request,
    });
    expect(out).toContain(SESSION_CONTEXT_BRIDGE_MARKER);
    expect(out).toContain("今天继续");
  });

  it("注入：本地明显多于网关 transcript", async () => {
    const local = [
      userMsg("u1", "昨天的问题 A"),
      assistantMsg("a1", "回答 A"),
      userMsg("u2", "昨天的问题 B"),
      assistantMsg("a2", "回答 B"),
      userMsg("u3", "今天继续"),
    ];
    const request = vi.fn(async () => ({
      messages: [{ role: "user", content: "昨天的问题 A" }],
    }));

    const out = await maybeInjectSessionContextBridge({
      sessionKey: "sk",
      remotePayload: "今天继续",
      localMessages: local,
      request,
    });
    expect(out).toContain(SESSION_CONTEXT_BRIDGE_MARKER);
    expect(out).toContain("昨天的问题 B");
    expect(out.endsWith("今天继续")).toBe(true);
  });

  it("不重复注入：payload 已含标记", async () => {
    const payload = `${SESSION_CONTEXT_BRIDGE_MARKER}\n\n已有接续\n\n---\n\n正文`;
    const out = await maybeInjectSessionContextBridge({
      sessionKey: "sk",
      remotePayload: payload,
      localMessages: [userMsg("u1", "a"), userMsg("u2", "b"), userMsg("u3", "c")],
      request: vi.fn(async () => ({ messages: [] })),
    });
    expect(out).toBe(payload);
  });

  it("不注入：网关已有与本地等价的 user 轮次（含接续块包装）", () => {
    const local = [
      userMsg("u1", "昨天的问题 A"),
      assistantMsg("a1", "回答 A"),
      userMsg("u2", "继续"),
    ];
    const out = bridgePayloadWithGatewayHistory(
      {
        messages: [
          { role: "user", content: "昨天的问题 A" },
          { role: "assistant", content: "回答 A" },
          {
            role: "user",
            content: `${SESSION_CONTEXT_BRIDGE_MARKER}\n摘要\n\n---\n\n继续`,
          },
        ],
      },
      local,
      "新的正文",
    );
    expect(out).toBe("新的正文");
  });
});
