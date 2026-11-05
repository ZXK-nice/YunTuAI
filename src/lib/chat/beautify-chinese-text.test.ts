import { describe, expect, it } from "vitest";
import { beautifyChineseText, detectCalloutKind } from "./beautify-chinese-text";

describe("beautifyChineseText", () => {
  it("adds space between CJK and ASCII", () => {
    expect(beautifyChineseText("使用YunTu Control网关")).toBe("使用 YunTu Control 网关");
  });

  it("does not alter fenced code blocks", () => {
    const raw = "说明\n```js\nconst x=1//中文comment\n```\n结束";
    expect(beautifyChineseText(raw)).toBe(raw);
  });

  it("collapses excessive blank lines", () => {
    expect(beautifyChineseText("a\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("detectCalloutKind", () => {
  it("detects warning callouts", () => {
    expect(detectCalloutKind("> **注意**：请先备份")).toBe("warning");
  });

  it("detects tip callouts", () => {
    expect(detectCalloutKind("> 💡 可尝试重启网关")).toBe("tip");
  });
});
