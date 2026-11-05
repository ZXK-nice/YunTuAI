import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_ONLY_TOOL_DENY_PATTERNS, patchSessionLocalOnlyForSend } from "./local-only-policy";
import { buildSessionsSendParams } from "./session-rpc";

const requestMock = vi.fn();

vi.mock("./gateway-runtime", () => ({
  getGatewayClient: () => ({
    isHelloOk: true,
    request: (...args: unknown[]) => requestMock(...args),
  }),
}));

describe("gateway send integration", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ ok: true });
  });

  it("sessions.send params wire localOnly metadata and denylist together", () => {
    const params = buildSessionsSendParams("agent:main:chat-1", "处理表格", {
      timeoutMs: 120_000,
      idempotencyKey: "idem-1",
      localOnlyMode: true,
      toolDenylist: LOCAL_ONLY_TOOL_DENY_PATTERNS,
    });
    expect(params.key).toBe("agent:main:chat-1");
    expect(params.message).toBe("处理表格");
    expect(params.metadata).toEqual({
      yuntuaiLocalOnly: true,
      toolDenylist: expect.arrayContaining(["web_search", "browser", "http"]),
    });
    expect((params.metadata as { toolDenylist: string[] }).toolDenylist.length).toBeGreaterThan(5);
  });

  it("patchSessionLocalOnlyForSend issues sessions.patch denylist when gateway hello ok", async () => {
    await patchSessionLocalOnlyForSend("agent:main:chat-2");
    expect(requestMock).toHaveBeenCalledWith(
      "sessions.patch",
      expect.objectContaining({
        key: "agent:main:chat-2",
        tools: {
          mode: "denylist",
          list: expect.arrayContaining(["web_search"]),
        },
      }),
      { timeoutMs: 5_000 },
    );
  });

  it("skips sessions.patch when session key empty", async () => {
    await patchSessionLocalOnlyForSend("   ");
    expect(requestMock).not.toHaveBeenCalled();
  });
});
