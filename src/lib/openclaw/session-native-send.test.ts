import { describe, expect, it, vi } from "vitest";
import {
  dispatchGatewayChatSend,
  gatewayMethodsSupportNativeChatSend,
  probeNativeChatSendSupported,
  resetNativeSendCapabilityCache,
} from "./session-native-send";

describe("session-native-send", () => {
  it("detects native chat send support from methods list", () => {
    expect(gatewayMethodsSupportNativeChatSend(["chat.send", "agent.wait", "health"])).toBe(true);
    expect(gatewayMethodsSupportNativeChatSend(["sessions.send"])).toBe(false);
  });

  it("probes list_methods and caches result", async () => {
    resetNativeSendCapabilityCache();
    const request = vi.fn().mockResolvedValue({ methods: ["chat.send", "agent.wait"] });
    await expect(probeNativeChatSendSupported(request)).resolves.toBe(true);
    await probeNativeChatSendSupported(request);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("prefers chat.send when supported and subscribed", async () => {
    resetNativeSendCapabilityCache();
    const notify = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ methods: ["chat.send", "agent.wait"] })
      .mockResolvedValueOnce({ ok: true });
    const result = await dispatchGatewayChatSend(
      { notify, request },
      { key: "k", message: "hi" },
      true,
      { request },
    );
    expect(result.mode).toBe("chat.send");
    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey: "k", message: "hi" }),
    );
    expect(request.mock.calls.some((c) => c[0] === "chat.send" && "key" in (c[1] as object))).toBe(
      false,
    );
    expect(notify).not.toHaveBeenCalled();
    expect(result.sendRpcPromise).toBeTruthy();
  });

  it("falls back to sessions.send when native unsupported", async () => {
    resetNativeSendCapabilityCache();
    const notify = vi.fn();
    const request = vi
      .fn()
      .mockResolvedValueOnce({ methods: ["sessions.send"] })
      .mockResolvedValueOnce({ ok: true });
    const result = await dispatchGatewayChatSend(
      { notify, request },
      { key: "k", message: "hi" },
      true,
      { request },
    );
    expect(result.mode).toBe("sessions.send");
    expect(request).toHaveBeenCalledWith("sessions.send", { key: "k", message: "hi" });
    expect(notify).not.toHaveBeenCalled();
  });
});
