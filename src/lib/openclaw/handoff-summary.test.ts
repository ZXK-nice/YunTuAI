import { describe, expect, it } from "vitest";
import { buildSummaryInput } from "./handoff-summary";

function userMessage(id: string, content: string, createdAt = String(id)) {
  return { id, sessionId: "x", role: "user" as const, content, createdAt };
}

describe("handoff-summary", () => {
  it("returns empty for no messages", () => {
    expect(buildSummaryInput([])).toBe("");
  });

  it("skips system messages and trims whitespace", () => {
    const out = buildSummaryInput([
      { id: "s1", sessionId: "x", role: "system", content: "内部指令，不应出现", createdAt: "0" },
      userMessage("u1", "  你好，帮我整理周报  "),
    ]);
    expect(out).not.toContain("内部指令");
    expect(out).toContain("用户：你好，帮我整理周报");
  });

  it("clips a single long message per-message cap", () => {
    const long = "字".repeat(900);
    const out = buildSummaryInput([userMessage("u1", long)]);
    // "用户：" 前缀 3 字符 + 内容 800（799 + 省略号）
    expect(out.length).toBeLessThanOrEqual(803);
    expect(out.endsWith("…")).toBe(true);
  });

  it("respects total input cap and keeps latest messages first", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      userMessage(`u${i}`, `消息编号 ${i}`),
    );
    const out = buildSummaryInput(messages);
    // 最旧（0 号）不应出现在最前面；最新（11 号）应出现
    expect(out.indexOf("消息编号 0")).toBe(-1);
    expect(out).toContain("消息编号 11");
    expect(out.length).toBeLessThanOrEqual(6_500);
  });
});
