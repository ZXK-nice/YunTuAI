import { describe, expect, it } from "vitest";
import {
  CONTEXT_PRESSURE_TOKENS,
  countCjkChars,
  estimateSessionTokens,
  estimateSessionTokensFromChars,
  humanizeContextLimitError,
  isContextLimitError,
  isContextPressure,
} from "./context-limit-policy";

describe("context-limit-policy", () => {
  it("estimates tokens: latin chars at ~4 chars per token", () => {
    expect(estimateSessionTokens([{ content: "abcd" }, { content: "ef" }])).toBe(2);
    expect(estimateSessionTokensFromChars(100, 0)).toBe(25);
  });

  it("estimates tokens: CJK chars at ~1 token each", () => {
    expect(countCjkChars("你好世界，这是一段中文。")).toBe(12);
    expect(estimateSessionTokens([{ content: "你好世界" }, { content: "中文对话" }])).toBe(8);
  });

  it("estimates tokens: mixed CJK + latin", () => {
    const out = estimateSessionTokens([{ content: "你好 hello 2026" }]);
    expect(countCjkChars("你好 hello 2026")).toBe(2);
    expect(out).toBe(5); // 2 CJK + ceil(12/4) latin
  });

  it("handles empty content", () => {
    expect(estimateSessionTokens([])).toBe(0);
    expect(estimateSessionTokens([{ content: "" }])).toBe(0);
  });

  it("detects context pressure threshold", () => {
    expect(isContextPressure(CONTEXT_PRESSURE_TOKENS - 1)).toBe(false);
    expect(isContextPressure(CONTEXT_PRESSURE_TOKENS)).toBe(true);
  });

  it("detects generic context limit errors", () => {
    expect(isContextLimitError("maximum context length exceeded")).toBe(true);
    expect(isContextLimitError("prompt is too long for this model")).toBe(true);
    expect(isContextLimitError("API key invalid")).toBe(false);
  });

  it("humanizes context limit errors with action hint", () => {
    const out = humanizeContextLimitError("maximum context length exceeded");
    expect(out).toContain("压缩上下文");
    expect(out).toContain("换用更大上下文的模型");
  });
});
