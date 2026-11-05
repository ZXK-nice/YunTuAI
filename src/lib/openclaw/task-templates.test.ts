import { describe, expect, it } from "vitest";
import { buildTaskTemplatePrompt, TASK_TEMPLATES } from "./task-templates";

describe("task-templates", () => {
  it("embeds YunTuAI task goal and output dir", () => {
    const t = TASK_TEMPLATES.find((x) => x.label === "客户文档");
    expect(t).toBeTruthy();
    const prompt = buildTaskTemplatePrompt(t!, { outputDir: "D:/out" });
    expect(prompt).toContain("【YunTu Control 办事任务】");
    expect(prompt).toContain("D:/out");
    expect(prompt).toContain("full-output-enforcement");
  });
});
