import { describe, expect, it } from "vitest";
import {
  COMPOSER_DRAFT_MAX_KEYS,
  trimComposerDrafts,
} from "./composer-draft-prefs";

describe("trimComposerDrafts", () => {
  it("drops orphan session drafts", () => {
    const trimmed = trimComposerDrafts(
      { orphan: "hello", keep: "world", __new__: "draft" },
      new Set(["keep"]),
    );
    expect(trimmed).toEqual({ keep: "world", __new__: "draft" });
  });

  it("caps total keys while preserving __new__", () => {
    const drafts: Record<string, string> = { __new__: "n" };
    for (let i = 0; i < COMPOSER_DRAFT_MAX_KEYS + 5; i += 1) {
      drafts[`s${i}`] = "x".repeat(i + 1);
    }
    const trimmed = trimComposerDrafts(drafts, new Set(Object.keys(drafts)));
    expect(trimmed["__new__"]).toBe("n");
    expect(Object.keys(trimmed).length).toBe(COMPOSER_DRAFT_MAX_KEYS);
    expect(trimmed["s0"]).toBe("x");
  });
});
