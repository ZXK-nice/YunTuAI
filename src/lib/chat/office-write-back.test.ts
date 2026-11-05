import { describe, expect, it } from "vitest";
import {
  parseOfficeWriteBackPayloads,
  parseOfficeWritePayload,
  stripOfficeWriteFences,
} from "./office-write-back";

describe("office-write-back", () => {
  it("parses xlsx fence JSON and strips it from display text", () => {
    const text = [
      "已整理完成。",
      "```yuntu-office-write",
      JSON.stringify({
        format: "xlsx",
        filename: "结果.xlsx",
        rows: [
          ["姓名", "金额"],
          ["张三", "12"],
        ],
      }),
      "```",
    ].join("\n");
    expect(parseOfficeWriteBackPayloads(text)).toEqual([
      {
        format: "xlsx",
        filename: "结果.xlsx",
        rows: [
          ["姓名", "金额"],
          ["张三", "12"],
        ],
      },
    ]);
    expect(stripOfficeWriteFences(text)).toBe("已整理完成。");
  });

  it("parses docx paragraphs and rejects empty tables", () => {
    const ok = parseOfficeWritePayload(
      JSON.stringify({ format: "docx", filename: "纪要.docx", paragraphs: ["一、结论"] }),
    );
    expect(ok).toEqual({ format: "docx", filename: "纪要.docx", paragraphs: ["一、结论"] });
    expect(parseOfficeWritePayload(JSON.stringify({ format: "xlsx", filename: "a.xlsx", rows: [] }))).toBeNull();
  });
});
