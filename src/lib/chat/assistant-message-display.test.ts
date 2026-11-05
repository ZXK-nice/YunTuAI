import { describe, expect, it } from "vitest";
import {
  collapseStreamRepetition,
  mergeStreamingText,
  parseAssistantMessageForBubble,
  sanitizeAssistantPersistContent,
  tryParseDisplayPayloadJson,
} from "./assistant-message-display";

describe("mergeStreamingText", () => {
  it("replaces with longer full snapshot", () => {
    const a = "Hello";
    const b = "Hello world";
    expect(mergeStreamingText(a, b)).toBe(b);
  });

  it("does not concatenate when snapshot contains prior text", () => {
    const a = '{"v":2,"text":"方案一';
    const b = '{"v":2,"text":"方案一：已完成"}';
    expect(mergeStreamingText(a, b)).toBe(b);
  });

  it("appends true incremental deltas", () => {
    expect(mergeStreamingText("ab", "cd")).toBe("abcd");
  });
});

describe("tryParseDisplayPayloadJson", () => {
  it("parses strict v2 json in content", () => {
    const raw = JSON.stringify({
      v: 2,
      text: "结论一行",
      thinking: "内部推理",
      files: [],
    });
    const parsed = tryParseDisplayPayloadJson(raw);
    expect(parsed?.text).toBe("结论一行");
    expect(parsed?.thinking).toBe("内部推理");
  });
});

describe("parseAssistantMessageForBubble", () => {
  it("extracts thinking when only content holds leaked json", () => {
    const raw = JSON.stringify({
      v: 2,
      text: "给用户看的正文",
      thinking: "思考区内容",
      files: [],
    });
    const parsed = parseAssistantMessageForBubble(null, raw);
    expect(parsed.text).toBe("给用户看的正文");
    expect(parsed.thinking).toBe("思考区内容");
  });
});

describe("sanitizeAssistantPersistContent", () => {
  it("unwraps leaked json before persist", () => {
    const raw = JSON.stringify({
      v: 2,
      text: "交付路径：output/foo.pdf",
      thinking: "推理",
      files: [],
    });
    const out = sanitizeAssistantPersistContent(raw);
    expect(out.content).toBe("交付路径：output/foo.pdf");
    expect(out.thinking).toBe("推理");
  });
});

describe("collapseStreamRepetition", () => {
  it("keeps one copy when identical chunk repeats", () => {
    const chunk = "结果已生成。方案一：高清版\n---\n";
    const raw = chunk.repeat(5);
    const out = collapseStreamRepetition(raw);
    expect(out).toBe(chunk.trim());
  });
});
