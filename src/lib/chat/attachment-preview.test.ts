import { describe, expect, it } from "vitest";
import { isAttachmentExtractBlockingSend } from "./attachment-preview";

describe("isAttachmentExtractBlockingSend", () => {
  it("only blocks while OCR/preview is in flight", () => {
    expect(isAttachmentExtractBlockingSend("extracting")).toBe(true);
    expect(isAttachmentExtractBlockingSend("pending")).toBe(false);
    expect(isAttachmentExtractBlockingSend("ocr_ok")).toBe(false);
    expect(isAttachmentExtractBlockingSend("office_ok")).toBe(false);
    expect(isAttachmentExtractBlockingSend(undefined)).toBe(false);
  });
});
