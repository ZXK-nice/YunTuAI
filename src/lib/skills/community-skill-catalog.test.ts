import { describe, expect, it } from "vitest";
import {
  COMMUNITY_SKILL_CATALOG,
  listAllCommunitySkills,
  listInstallableCommunitySkills,
  communityBundleStats,
  isCommunitySkillDelisted,
  listCommunitySkillCategories,
} from "./community-skill-catalog";

describe("community-skill-catalog", () => {
  it("catalog has skills array", () => {
    expect(COMMUNITY_SKILL_CATALOG.skills.length).toBeGreaterThan(0);
  });

  it("excludes delisted video skills from workshop listing", () => {
    const listed = listAllCommunitySkills();
    expect(listed.length).toBeLessThan(COMMUNITY_SKILL_CATALOG.skillCount);
    expect(isCommunitySkillDelisted("video-creation-pro")).toBe(true);
    expect(listed.some((s) => s.dirName === "video-creation-pro")).toBe(false);
    expect(listCommunitySkillCategories().some((c) => c.label === "视频创作")).toBe(false);
  });

  it("lists only non-delisted catalog skills for browsing", () => {
    const stats = communityBundleStats();
    expect(listAllCommunitySkills().length).toBe(stats.catalogCount);
    expect(stats.delistedCount).toBeGreaterThan(0);
  });

  it("skill descriptions are localized (no leftover English-only blurbs)", () => {
    const mostlyEnglish = COMMUNITY_SKILL_CATALOG.skills.filter((s) => {
      const d = s.description;
      const cjk = (d.match(/[\u4e00-\u9fff]/g) ?? []).length;
      const asciiWords = (d.match(/[A-Za-z]{3,}/g) ?? []).length;
      return asciiWords > 3 && cjk < d.length * 0.15;
    });
    expect(mostlyEnglish.map((s) => s.dirName)).toEqual([]);
  });

  it("installable list is subset of listed catalog when bundle manifest empty", () => {
    const stats = communityBundleStats();
    const installable = listInstallableCommunitySkills();
    expect(installable.length).toBeLessThanOrEqual(listAllCommunitySkills().length);
    expect(stats.catalogCount).toBe(listAllCommunitySkills().length);
  });
});
