import { describe, expect, it } from "vitest";
import {
  adaptSendParamsForGatewayMethod,
  buildChatSendParams,
  buildSessionsSendParams,
} from "./session-rpc";

describe("buildSessionsSendParams", () => {
  it("attaches local-only and yuntuai metadata when enabled", () => {
    const p = buildSessionsSendParams("sess-1", "hello", {
      localOnlyMode: true,
      toolDenylist: ["web_search", "http"],
      yuntuai: {
        sendId: "send-abc",
        taskPlanId: "send-abc",
        officeAttachmentKinds: ["spreadsheet"],
        ocrContentHash: "deadbeef",
        preExtractSummary: "【表格预提取】\nA1",
      },
    });
    expect(p.metadata).toEqual({
      yuntuaiLocalOnly: true,
      toolDenylist: ["web_search", "http"],
      yuntuaiSendId: "send-abc",
      yuntuaiTaskPlanId: "send-abc",
      yuntuaiOfficeKinds: ["spreadsheet"],
      yuntuaiOcrHash: "deadbeef",
      yuntuaiPreExtract: "【表格预提取】\nA1",
    });
  });
});

describe("chat.send params", () => {
  it("uses sessionKey instead of key", () => {
    const p = buildChatSendParams("agent:main:dashboard:abc", "hi", { timeoutMs: 60_000 });
    expect(p.sessionKey).toBe("agent:main:dashboard:abc");
    expect(p.key).toBeUndefined();
    expect(p.message).toBe("hi");
  });

  it("adaptSendParamsForGatewayMethod maps key to sessionKey for chat.send", () => {
    const sessions = buildSessionsSendParams("sk-1", "msg", {
      yuntuai: { sendId: "s1", taskPlanId: "s1" },
    });
    const chat = adaptSendParamsForGatewayMethod("chat.send", sessions);
    expect(chat.sessionKey).toBe("sk-1");
    expect(chat.key).toBeUndefined();
    expect(chat.metadata).toBeUndefined();
    const plain = adaptSendParamsForGatewayMethod("sessions.send", sessions);
    expect(plain.key).toBe("sk-1");
    expect(plain.metadata).toBeUndefined();
  });
});
