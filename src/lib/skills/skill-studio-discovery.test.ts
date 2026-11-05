import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQuestions,
  formatDiscoveryBrief,
  isDiscoverySufficient,
  mergeDiscoveryIntoInput,
  parseAiFollowUpQuestions,
} from "./skill-studio-discovery";

describe("skill-studio-discovery", () => {
  it("builds industry-specific questions for sales", () => {
    const qs = buildDiscoveryQuestions({
      industryId: "sales",
      roleId: "inside-sales",
      industryLabel: "销售与商务",
      roleLabel: "电话/线上销售",
      scenarios: [{ id: "a", label: "陌拜话术", summary: "test" }],
      isCustom: false,
    });
    expect(qs.some((q) => q.id === "sales-customer")).toBe(true);
    expect(qs.some((q) => q.id === "daily-pain")).toBe(true);
    expect(qs.some((q) => q.question.includes("陌拜"))).toBe(true);
  });

  it("requires minimum answers before sufficient", () => {
    const qs = buildDiscoveryQuestions({
      industryId: "custom",
      roleId: "freeform",
      industryLabel: "其他",
      roleLabel: "岗位",
      scenarios: [],
      isCustom: true,
    });
    expect(isDiscoverySufficient(qs, {})).toBe(false);
    expect(
      isDiscoverySufficient(qs, {
        [qs[0]!.id]: "我每天要处理很多门店巡店报告",
        [qs[1]!.id]: "输出要口语化",
      }),
    ).toBe(true);
  });

  it("merges brief into draft input notes", () => {
    const merged = mergeDiscoveryIntoInput(
      {
        industryId: "sales",
        roleId: "inside-sales",
        selectedScenarioIds: [],
        customNotes: "原有备注",
      },
      formatDiscoveryBrief(
        [{ id: "q1", question: "问什么" }],
        { q1: "答什么" },
      ),
    );
    expect(merged.customNotes).toContain("【沟通澄清】");
    expect(merged.customNotes).toContain("原有备注");
  });

  it("parses ai follow-up json", () => {
    const qs = parseAiFollowUpQuestions(
      '好的：[{"question":"你们客单价大概多少？","placeholder":"区间即可"}]',
    );
    expect(qs).toHaveLength(1);
    expect(qs[0]?.question).toContain("客单价");
  });
});
