import { describe, expect, it } from "vitest";
import {
  buildSkillDirSlug,
  buildSkillMdDraft,
  extractSkillMdFromAiResponse,
  isValidSkillDirName,
} from "./skill-md-draft";

describe("skill-md-draft", () => {
  it("builds slug from industry and role ids", () => {
    const slug = buildSkillDirSlug({
      industryId: "foreign-trade",
      roleId: "sales-follow",
      selectedScenarioIds: [],
      customNotes: "",
    });
    expect(slug).toBe("foreign-trade-sales-follow");
    expect(isValidSkillDirName(slug)).toBe(true);
  });

  it("generates SKILL.md with playbook sections for sales", () => {
    const draft = buildSkillMdDraft({
      industryId: "sales",
      roleId: "inside-sales",
      selectedScenarioIds: ["cold-call-script", "objection-price"],
      customNotes: "语气偏干练",
    });
    expect(draft).not.toBeNull();
    expect(draft!.skillMd).toContain("陌拜话术");
    expect(draft!.skillMd).toContain("推荐做法");
    expect(draft!.skillMd).toContain("always: true");
    expect(draft!.skillMd).toContain("自动启用");
    expect(draft!.skillMd).not.toContain("按公司模板输出，标注需人工复核的字段");
    expect(draft!.industryLabel).toBe("销售与商务");
  });

  it("injects always metadata into AI override drafts", () => {
    const draft = buildSkillMdDraft(
      {
        industryId: "sales",
        roleId: "inside-sales",
        selectedScenarioIds: ["cold-call-script"],
        customNotes: "",
      },
      {
        skillMdOverride: "---\nname: sales-inside-sales\ndescription: demo\n---\n\n# x\n",
        source: "ai",
      },
    );
    expect(draft!.skillMd).toContain("always: true");
    expect(draft!.source).toBe("ai");
  });

  it("supports custom industry freeform", () => {
    const draft = buildSkillMdDraft({
      industryId: "custom",
      roleId: "freeform",
      selectedScenarioIds: [],
      customIndustryLabel: "宠物用品",
      customRoleLabel: "电商运营",
      customScenarioText: "每周写店铺活动页和客服话术",
      customNotes: "",
    });
    expect(draft).not.toBeNull();
    expect(draft!.dirName.startsWith("custom-")).toBe(true);
    expect(draft!.skillMd).toContain("宠物用品");
    expect(draft!.skillMd).toContain("每周写店铺活动页");
  });

  it("extracts markdown fenced skill from ai response", () => {
    const md = extractSkillMdFromAiResponse(
      "好的：\n```markdown\n---\nname: demo\n---\n\n# Hi\n```",
    );
    expect(md).toContain("name: demo");
  });

  it("returns null for unknown industry/role", () => {
    expect(
      buildSkillMdDraft({
        industryId: "unknown",
        roleId: "x",
        selectedScenarioIds: [],
        customNotes: "",
      }),
    ).toBeNull();
  });
});
