import { describe, expect, it } from "vitest";
import {
  buildHeuristicTaskPlan,
  buildSessionHandoffSummary,
  extractParallelSubtaskPrompts,
  parseTaskPlanFromAssistant,
  shouldEnableTaskOrchestration,
} from "./task-orchestration";

describe("task-orchestration", () => {
  it("enables orchestration for templates and long prompts", () => {
    expect(shouldEnableTaskOrchestration("hi", { templateId: "x" })).toBe(true);
    expect(shouldEnableTaskOrchestration("a".repeat(120))).toBe(true);
    expect(shouldEnableTaskOrchestration("帮我整理表格")).toBe(true);
    expect(shouldEnableTaskOrchestration("请核对发票")).toBe(true);
    expect(shouldEnableTaskOrchestration("你好")).toBe(false);
  });

  it("parses assistant plan block", () => {
    const text = `## 执行计划
1. 读取资料
2. 生成报告 (并行)
3. 自检输出

开始执行…`;
    const plan = parseTaskPlanFromAssistant(text);
    expect(plan?.length).toBeGreaterThanOrEqual(2);
    expect(plan?.[1]?.parallelGroupId).toBe("pg-parallel");
  });

  it("builds handoff summary from messages", () => {
    const summary = buildSessionHandoffSummary([
      { id: "1", role: "user", content: "请写方案", createdAt: "1" },
      { id: "2", role: "assistant", content: "好的", createdAt: "2" },
    ] as never);
    expect(summary).toContain("上一对话摘要");
    expect(summary).toContain("请写方案");
  });

  it("builds heuristic plan without fake parallel UI markers", () => {
    const plan = buildHeuristicTaskPlan("请对比调研三家供应商");
    const parallel = plan.filter((p) => p.parallelGroupId);
    expect(parallel.length).toBe(0);
    expect(plan.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts parallel prompts only when plan has >=2 parallel markers", () => {
    const oneParallel = parseTaskPlanFromAssistant(`## 执行计划
1. 收集 A
2. 收集 B (并行)
3. 汇总
`);
    // 仅 1 个并行标记时不启后台子任务
    expect(extractParallelSubtaskPrompts(oneParallel!, "对比").length).toBe(0);

    const twoParallel = parseTaskPlanFromAssistant(`## 执行计划
1. 路线 A (并行)
2. 路线 B (并行)
3. 汇总
`);
    expect(extractParallelSubtaskPrompts(twoParallel!, "对比").length).toBe(2);
  });
});
