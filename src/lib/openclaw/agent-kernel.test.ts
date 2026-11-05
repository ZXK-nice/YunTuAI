import { describe, expect, it } from "vitest";
import {
  classifyTaskIntent,
  enrichPayloadWithAgentKernel,
  isSensitiveLocalTask,
  shouldUseAgentKernel,
} from "./agent-kernel";

describe("agent-kernel", () => {
  it("classifies office intents", () => {
    expect(classifyTaskIntent("请整理 Excel 销售数据")).toBe("data");
    expect(classifyTaskIntent("写一份周报")).toBe("document");
    expect(classifyTaskIntent("调研三家竞品")).toBe("research");
    expect(classifyTaskIntent("核对财务报销凭证")).toBe("sensitive");
  });

  it("detects sensitive local tasks", () => {
    expect(isSensitiveLocalTask("审查合同条款")).toBe(true);
    expect(isSensitiveLocalTask("写公开博客")).toBe(false);
  });

  it("enables kernel for attachments with short prompt", () => {
    expect(shouldUseAgentKernel("请处理附件", { hasAttachments: true })).toBe(true);
  });

  it("injects office contract when spreadsheet attached", () => {
    const r = enrichPayloadWithAgentKernel("汇总这张表", {
      hasAttachments: true,
      officeAttachmentKinds: ["spreadsheet"],
    });
    expect(r.orchestrationEnabled).toBe(true);
    expect(r.payload).toContain("办公文件处理");
    expect(r.payload).toContain("预提取");
    expect(r.initialPlan?.some((s) => s.title.includes("预提取"))).toBe(true);
  });

  it("injects automation contract for automation intent", () => {
    const r = enrichPayloadWithAgentKernel("每天定时整理 inbox 文件");
    expect(r.intent).toBe("automation");
    expect(r.payload).toContain("自动化任务");
  });

  it("injects planning and security hints", () => {
    const r = enrichPayloadWithAgentKernel("请核对财务合同并生成摘要");
    expect(r.orchestrationEnabled).toBe(true);
    expect(r.intent).toBe("sensitive");
    expect(r.payload).toContain("云图任务模式");
    expect(r.payload).toContain("回复风格");
    expect(r.payload).toContain("本地优先");
    expect(r.initialPlan?.length).toBeGreaterThanOrEqual(2);
  });

  it("injects local-only hint when enabled", () => {
    const r = enrichPayloadWithAgentKernel("整理桌面文件", { localOnlyMode: true });
    expect(r.payload).toContain("仅本机执行");
  });

  it("skips enrichment for trivial chat", () => {
    const r = enrichPayloadWithAgentKernel("你好");
    expect(r.orchestrationEnabled).toBe(false);
    expect(r.payload).toBe("你好");
  });
});
