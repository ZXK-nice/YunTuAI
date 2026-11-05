import { beforeEach, describe, expect, it } from "vitest";
import {
  abortActiveSendForGatewayError,
  clearActiveSendState,
  consumeActiveSendFinishReason,
  getActiveSendHandle,
  markActiveSendWsComplete,
  setActiveSendHandle,
  touchActiveSendWsEvent,
} from "../session-send-active";

describe("session-send-active", () => {
  beforeEach(() => {
    clearActiveSendState();
  });

  it("tracks ws activity for matching session key", () => {
    const ac = new AbortController();
    setActiveSendHandle({
      controller: ac,
      sessionKey: "agent:main:main",
      sendStartedAtMs: Date.now(),
      lastWsEventAt: 1000,
    });
    touchActiveSendWsEvent("agent:main:main");
    expect(getActiveSendHandle()?.lastWsEventAt).toBeGreaterThan(1000);
  });

  it("marks ws_complete and aborts controller", () => {
    const ac = new AbortController();
    setActiveSendHandle({
      controller: ac,
      sessionKey: "k1",
      sendStartedAtMs: Date.now(),
      lastWsEventAt: Date.now(),
    });
    expect(markActiveSendWsComplete("k1")).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    expect(consumeActiveSendFinishReason()).toBe("ws_complete");
  });

  it("sets gateway_error on fatal gateway event", () => {
    const ac = new AbortController();
    setActiveSendHandle({
      controller: ac,
      sessionKey: "k1",
      sendStartedAtMs: Date.now(),
      lastWsEventAt: Date.now(),
    });
    abortActiveSendForGatewayError("k1", "upstream failed");
    expect(consumeActiveSendFinishReason()).toBe("gateway_error");
  });
});
