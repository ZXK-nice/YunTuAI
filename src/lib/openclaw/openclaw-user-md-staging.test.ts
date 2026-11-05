import { describe, expect, it } from "vitest";
import {
  buildUserMdStagingSection,
  INLINE_STAGING_CONTENT_MAX_CHARS,
  shouldUsePathReference,
  workspaceInboxRelPath,
} from "./openclaw-user-md-staging";

describe("openclaw-user-md-staging path refs", () => {
  it("inlines small files fully", () => {
    const section = buildUserMdStagingSection("abc123", [
      { displayName: "note.md", content: "hello world" },
    ]);
    expect(section).toContain("全文内嵌");
    expect(section).toContain("hello world");
    expect(section).toContain("workspace/inbox/abc123/note.md");
  });

  it("uses path reference for large files", () => {
    const big = "x".repeat(INLINE_STAGING_CONTENT_MAX_CHARS + 50);
    expect(shouldUsePathReference(big)).toBe(true);
    const section = buildUserMdStagingSection("abc123", [
      { displayName: "big.txt", content: big, workspaceRelPath: workspaceInboxRelPath("abc123", "big.txt") },
    ]);
    expect(section).toContain("路径引用");
    expect(section).toContain("workspace/inbox/abc123/big.txt");
    expect(section.length).toBeLessThan(big.length);
  });
});
