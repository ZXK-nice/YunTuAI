import { describe, expect, it } from "vitest";
import {
  findLegacyOfficeNames,
  isLegacyOfficeFileName,
  legacyOfficeUserMessage,
} from "./office-legacy-formats";

describe("office-legacy-formats", () => {
  it("treats .doc and .ppt as supported (backend converts locally)", () => {
    expect(isLegacyOfficeFileName("report.doc")).toBe(false);
    expect(isLegacyOfficeFileName("slides.ppt")).toBe(false);
    expect(isLegacyOfficeFileName("report.docx")).toBe(false);
    expect(isLegacyOfficeFileName("slides.pptx")).toBe(false);
    expect(isLegacyOfficeFileName("data.xls")).toBe(false);
  });

  it("keeps actionable fallback messages", () => {
    expect(legacyOfficeUserMessage("a.doc")).toMatch(/docx/);
    expect(legacyOfficeUserMessage("b.ppt")).toMatch(/pptx/);
  });

  it("findLegacyOfficeNames returns empty (no upfront block)", () => {
    expect(findLegacyOfficeNames(["a.docx", "b.doc", "c.pdf"])).toEqual([]);
  });
});