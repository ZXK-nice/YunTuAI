import { describe, expect, it } from "vitest";
import {
  buildYuntuaiSendMetadata,
  extractGatewayEventIds,
  extractPreExtractMeta,
  normalizeGatewayEvent,
} from "./gateway-event-schema";

describe("gateway-event-schema", () => {
  it("skips heartbeat and index events", () => {
    expect(normalizeGatewayEvent("heartbeat", {})).toBeNull();
    expect(normalizeGatewayEvent("sessions.changed", {})).toBeNull();
    expect(normalizeGatewayEvent("tick", {})).toBeNull();
    expect(normalizeGatewayEvent("agent.tick", { sessionKey: "agent:main:main" })).toBeNull();
  });

  it("normalizes session.tool with toolCallId", () => {
    const norm = normalizeGatewayEvent("session.tool", {
      toolCallId: "tc-1",
      name: "read_file",
      phase: "start",
    });
    expect(norm).not.toBeNull();
    expect(norm?.toolCallId).toBe("tc-1");
    expect(norm?.status).toBe("running");
  });

  it("extracts pre-extract summary and stable hash", () => {
    const payload = [
      "请处理附件",
      "【表格预提取】",
      "姓名,年龄",
      "张三,20",
    ].join("\n");
    const meta = extractPreExtractMeta(payload);
    expect(meta.summary).toContain("【表格预提取】");
    expect(meta.hash).toMatch(/^[0-9a-f]+$/);
    expect(extractPreExtractMeta(payload).hash).toBe(meta.hash);
  });

  it("extracts runId from chat payload", () => {
    expect(extractGatewayEventIds({ runId: "run-9", sessionKey: "sk" })).toEqual({
      sessionKey: "sk",
      runId: "run-9",
    });
    const norm = normalizeGatewayEvent("chat", { runId: "run-9", state: "delta" });
    expect(norm?.runId).toBe("run-9");
  });

  it("builds yuntuai metadata for office send", () => {
    const meta = buildYuntuaiSendMetadata({
      sendId: "send-1",
      taskOrchestration: true,
      attachedFiles: [{ name: "data.xlsx" }],
      remotePayload: "【OCR 第1张 · a.png · tesseract】\nhello",
    });
    expect(meta.sendId).toBe("send-1");
    expect(meta.taskPlanId).toBe("send-1");
    expect(meta.officeAttachmentKinds).toContain("spreadsheet");
    expect(meta.officeContractVersion).toBe("1");
    expect(meta.officeSkillIds).toContain("yuntuai-office-xlsx");
    expect(meta.ocrContentHash).toBeTruthy();
    expect(meta.preExtractSummary).toContain("OCR");
  });
});
