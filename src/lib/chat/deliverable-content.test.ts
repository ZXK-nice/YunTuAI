import { describe, expect, it } from "vitest";
import {
  extractTrackedJobIds,
  isDeliveredAssistantContent,
  isInterimAssistantStatus,
  partitionAssistantContent,
} from "./deliverable-content";

const JOB = "337f0385-378b-4419-bb89-5422f052cac2";

describe("deliverable-content", () => {
  it("detects interim AOS status as non-delivered", () => {
    const text = `轮询已在后台运行。
- **job_id**：\`${JOB}\`
后台持续轮询，终态会自动汇报。`;
    expect(isInterimAssistantStatus(text)).toBe(true);
    expect(isDeliveredAssistantContent(text)).toBe(false);
  });

  it("splits english reasoning prefix from chinese deliverable block", () => {
    const raw = `I understand the context. Let me check the script and execute the publish flow for the user.

**✅ E2E 发布已入队**
- **job_id**：\`${JOB}\``;
    const out = partitionAssistantContent(raw);
    expect(out.body).toContain("E2E 发布已入队");
    expect(out.thinking).toMatch(/I understand/i);
  });

  it("extracts job ids near job keyword", () => {
    expect(extractTrackedJobIds(`job_id=${JOB}`)).toEqual([JOB]);
  });

  it("treats terminal platform table as delivered", () => {
    const text = `| 抖音 | 测试1 | 录屏1 | success | - |
| 快手 | 测试1 | 录屏2 | success | - |
| 小红书 | 测试1 | 录屏1 | failed | rate_limit |`;
    expect(isDeliveredAssistantContent(text)).toBe(true);
  });

  it("treats short planning text as non-delivered", () => {
    expect(isDeliveredAssistantContent("让我批量搜索深圳软件类 AI 公司。")).toBe(false);
  });

  it("treats checkmark summary as delivered", () => {
    expect(isDeliveredAssistantContent("**✅ 已完成**\n\n讯飞摘星尽调报告已写入桌面。")).toBe(true);
  });
});
