import { describe, expect, it } from "vitest";
import { prepareSendKernel } from "../session-send-kernel";

describe("prepareSendKernel", () => {
  it("injects local-only hint when enabled", () => {
    const r = prepareSendKernel("你好", {
      localDisplay: "你好",
      localOnlyMode: true,
      sendId: "send-1",
    });
    expect(r.remotePayload).toContain("仅本机执行");
  });

  it("enables orchestration for office-like tasks", () => {
    const r = prepareSendKernel("帮我整理 Excel 表格并导出", {
      localDisplay: "帮我整理 Excel 表格并导出",
      sendId: "send-2",
      attachedFiles: [{ name: "data.xlsx" }],
    });
    expect(r.taskOrchestration).toBe(true);
    expect(r.initialPlanSteps?.length).toBeGreaterThan(0);
  });
});
