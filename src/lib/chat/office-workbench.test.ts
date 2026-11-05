import { describe, expect, it } from "vitest";
import {
  classifyOfficeAttachment,
  hasOfficeOrAutomationAttachments,
  OFFICE_EXECUTION_CONTRACT,
  summarizeOfficeAttachments,
} from "./office-workbench";

describe("office-workbench", () => {
  it("classifies common office formats", () => {
    expect(classifyOfficeAttachment("销售.xlsx")).toBe("spreadsheet");
    expect(classifyOfficeAttachment("名单.csv")).toBe("csv");
    expect(classifyOfficeAttachment("报告.docx")).toBe("document");
    expect(classifyOfficeAttachment("演示.pptx")).toBe("presentation");
    expect(classifyOfficeAttachment("scan.pdf")).toBe("pdf");
    expect(classifyOfficeAttachment("photo.png")).toBe("image");
    expect(classifyOfficeAttachment("app.exe")).toBeNull();
  });

  it("summarizes attachment sets", () => {
    const kinds = summarizeOfficeAttachments([
      { name: "a.xlsx" },
      { name: "b.csv" },
      { name: "c.png" },
    ]);
    expect(kinds.sort()).toEqual(["csv", "image", "spreadsheet"]);
    expect(hasOfficeOrAutomationAttachments([{ name: "readme.md" }])).toBe(false);
  });

  it("teaches agents the built-in write-back fence before PowerShell", () => {
    expect(OFFICE_EXECUTION_CONTRACT).toContain("yuntu-office-write");
    expect(OFFICE_EXECUTION_CONTRACT).toContain("内置写回");
    const fenceAt = OFFICE_EXECUTION_CONTRACT.indexOf("yuntu-office-write");
    const ps1At = OFFICE_EXECUTION_CONTRACT.indexOf("yuntu-office-write.ps1");
    expect(fenceAt).toBeGreaterThan(0);
    expect(ps1At).toBeGreaterThan(fenceAt);
  });
});
