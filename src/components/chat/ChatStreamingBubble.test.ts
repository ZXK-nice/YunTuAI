import { describe, expect, it } from "vitest";
import { shouldHideStreamingPlaceholder } from "./ChatStreamingBubble";

describe("shouldHideStreamingPlaceholder", () => {
  it("hides placeholder when draft is empty and last turn already has a deliverable", () => {
    expect(
      shouldHideStreamingPlaceholder("", "", [
        { role: "user", content: "整理这份表格" },
        { role: "assistant", content: "已写入桌面：结果.xlsx。结论：共 12 行。" },
      ]),
    ).toBe(true);
  });

  it("keeps placeholder while waiting after the latest user message", () => {
    expect(
      shouldHideStreamingPlaceholder("", "", [
        { role: "assistant", content: "上一轮已经完成。" },
        { role: "user", content: "再导出一份" },
      ]),
    ).toBe(false);
  });

  it("keeps placeholder while streaming body or thinking", () => {
    const msgs = [{ role: "assistant", content: "已完成交付。" }];
    expect(shouldHideStreamingPlaceholder("正在写…", "", msgs)).toBe(false);
    expect(shouldHideStreamingPlaceholder("", "先看表格结构", msgs)).toBe(false);
  });
});
