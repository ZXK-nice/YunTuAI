import { describe, expect, it } from "vitest";
import {
  defaultSelectedRecommendationDirs,
  getRoleSkillRecommendations,
} from "./skill-role-recommendations";

describe("skill-role-recommendations", () => {
  it("recommends patent + writing stack for IP specialist", () => {
    const recs = getRoleSkillRecommendations("legal-compliance", "ip-specialist");
    const dirs = recs.map((r) => r.dirName);
    expect(dirs).toContain("paper-to-patent");
    expect(dirs).toContain("scipilot-writing");
  });

  it("recommends tyc-it for all B2B sales by default", () => {
    const recs = getRoleSkillRecommendations("sales", "b2b-enterprise");
    expect(recs.some((r) => r.dirName === "tyc-it")).toBe(true);
    const defaults = defaultSelectedRecommendationDirs("sales", "b2b-enterprise");
    expect(defaults).toContain("tyc-it");
  });

  it("recommends tyc-it for inside sales and channel sales", () => {
    expect(getRoleSkillRecommendations("sales", "inside-sales").map((r) => r.dirName)).toContain("tyc-it");
    expect(getRoleSkillRecommendations("sales", "channel-sales").map((r) => r.dirName)).toContain("tyc-it");
  });

  it("recommends anti-vibe for content marketing copywriter", () => {
    const recs = getRoleSkillRecommendations("content-marketing", "copywriter");
    expect(recs.some((r) => r.dirName === "anti-vibe-writing")).toBe(true);
  });

  it("recommends skill authoring for developers", () => {
    const recs = getRoleSkillRecommendations("software-rd", "developer");
    expect(recs.some((r) => r.dirName === "skills-best-practices")).toBe(true);
    expect(recs.some((r) => r.dirName === "skill-development")).toBe(true);
  });

  it("recommends resume skill for recruiter", () => {
    const recs = getRoleSkillRecommendations("admin-hr", "recruiter");
    expect(recs.some((r) => r.dirName === "tailored-resume-generator")).toBe(true);
  });

  it("recommends chrome automation for foreign trade", () => {
    const recs = getRoleSkillRecommendations("foreign-trade", "sales-follow");
    expect(recs.some((r) => r.dirName === "chrome-automation")).toBe(true);
  });

  it("account-plan scenario boosts tyc-it", () => {
    const recs = getRoleSkillRecommendations("sales", "b2b-enterprise", ["account-plan"]);
    expect(recs.filter((r) => r.dirName === "tyc-it").length).toBeGreaterThanOrEqual(1);
  });
});
