import { describe, expect, it } from "vitest";
import { appendOutputDirHint } from "./output-dir-hint";

describe("appendOutputDirHint", () => {
  it("appends marker when dir provided", () => {
    const out = appendOutputDirHint("你好", "D:\\Reports");
    expect(out).toContain("D:\\Reports");
    expect(out).toContain("【输出目录】");
  });

  it("does not duplicate when path already present", () => {
    const base = "保存到 D:\\Reports\\file.xlsx";
    expect(appendOutputDirHint(base, "D:\\Reports")).toBe(base);
  });
});
