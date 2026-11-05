import { describe, expect, it } from "vitest";
import {
  deriveSessionTitle,
  isDefaultSessionTitle,
  shouldAutoTitleSession,
} from "./session-auto-title";

describe("isDefaultSessionTitle", () => {
  it("matches default session names", () => {
    expect(isDefaultSessionTitle("新会话")).toBe(true);
    expect(isDefaultSessionTitle("新会话（2）")).toBe(true);
    expect(isDefaultSessionTitle("新会话 1710000000")).toBe(true);
    expect(isDefaultSessionTitle("写 Python 脚本")).toBe(false);
  });
});

describe("deriveSessionTitle", () => {
  it("summarizes from assistant reply instead of copying user verbatim", () => {
    const title = deriveSessionTitle(
      "帮我写一个 Python 脚本，用来批量重命名图片",
      "好的，下面是一个使用 os.rename 批量重命名图片的 Python 脚本示例。",
    );
    expect(title).not.toContain("帮我写");
    expect(title.length).toBeLessThanOrEqual(36);
  });

  it("falls back to assistant topic when user message is weak", () => {
    const title = deriveSessionTitle("你好", "这是关于 React Hooks 的说明文档。");
    expect(title.length).toBeLessThanOrEqual(36);
    expect(title).toContain("React Hooks");
  });

  it("uses attachment name when only files sent", () => {
    expect(deriveSessionTitle("（附件：季度报告.docx）")).toBe("季度报告");
  });

  it("truncates long titles", () => {
    const title = deriveSessionTitle(
      "这是一个非常非常非常非常非常非常非常非常非常非常非常非常长的标题需要被截断",
    );
    expect(title.length).toBeLessThanOrEqual(36);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("shouldAutoTitleSession", () => {
  it("only auto titles first exchange on default name", () => {
    expect(
      shouldAutoTitleSession("新会话", ["你好"], ["你好，有什么可以帮你？"]),
    ).toBe(true);
    expect(
      shouldAutoTitleSession("已有标题", ["你好"], ["你好，有什么可以帮你？"]),
    ).toBe(false);
    expect(
      shouldAutoTitleSession("新会话", ["你好", "再问一句"], ["回复1", "回复2"]),
    ).toBe(false);
  });
});
