import { describe, expect, it } from "vitest";
import { guardPendingAttachmentNames } from "./pending-attachment-guard";

describe("pending-attachment-guard", () => {
  it("allows modern office files", () => {
    expect(guardPendingAttachmentNames(["a.docx", "b.xlsx"])).toEqual({ ok: true });
  });

  it("allows legacy .doc / .ppt (backend attempts local conversion)", () => {
    expect(guardPendingAttachmentNames(["legacy.doc"])).toEqual({ ok: true });
    expect(guardPendingAttachmentNames(["slides.ppt"])).toEqual({ ok: true });
  });
});