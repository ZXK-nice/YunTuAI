import { describe, expect, it } from "vitest";
import { inferSkillRuntimeTier } from "./skill-runtime-tier";

describe("inferSkillRuntimeTier", () => {
  it("marks scrapling as needs-runtime", () => {
    expect(inferSkillRuntimeTier("scrapling", "")).toBe("needs-runtime");
  });

  it("marks plain skills as bundled", () => {
    expect(inferSkillRuntimeTier("paper-to-patent", "专利撰写")).toBe("bundled");
  });
});
