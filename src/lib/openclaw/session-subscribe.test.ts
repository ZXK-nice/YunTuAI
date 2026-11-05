import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayWsClient } from "./gateway-client";
import {
  clearSessionSubscriptionTracking,
  ensureSessionsMessagesSubscribed,
  ensureSessionsMessagesSubscribedForSend,
  invalidateSessionSubscription,
} from "./session-subscribe";

function mockClient(request: ReturnType<typeof vi.fn>): GatewayWsClient {
  return {
    isHelloOk: true,
    request,
  } as unknown as GatewayWsClient;
}

describe("ensureSessionsMessagesSubscribed", () => {
  beforeEach(() => {
    clearSessionSubscriptionTracking();
  });

  it("returns early when client not hello-ready", async () => {
    const client = { isHelloOk: false, request: vi.fn() } as unknown as GatewayWsClient;
    const r = await ensureSessionsMessagesSubscribed(client, "sess-1");
    expect(r).toEqual({ canonicalKey: "sess-1", eventsSubscribed: false });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("marks eventsSubscribed false when RPC returns subscribed: false", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: false, key: "canonical-1" };
      }
      if (method === "chat.history") return { messages: [] };
      return {};
    });
    const r = await ensureSessionsMessagesSubscribed(mockClient(request), "sess-1");
    expect(r).toEqual({ canonicalKey: "canonical-1", eventsSubscribed: false });
  });

  it("uses cache when eventsSubscribed true without extra RPC", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "canonical-1" };
      }
      if (method === "chat.history") return { messages: [] };
      return {};
    });
    const client = mockClient(request);
    await ensureSessionsMessagesSubscribed(client, "sess-1");
    const callsAfterFirst = request.mock.calls.length;
    await ensureSessionsMessagesSubscribed(client, "sess-1");
    expect(request.mock.calls.length).toBe(callsAfterFirst);
    expect(request.mock.calls.some(([m]) => m === "sessions.messages.subscribe")).toBe(true);
    expect(request.mock.calls.filter(([m]) => m === "chat.history").length).toBe(1);
  });
});

describe("ensureSessionsMessagesSubscribedForSend", () => {
  beforeEach(() => {
    clearSessionSubscriptionTracking();
  });

  it("弱订阅时会重试 subscribe", async () => {
    let subscribeCalls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        subscribeCalls += 1;
        return subscribeCalls >= 2
          ? { subscribed: true, key: "canonical-1" }
          : { subscribed: false, key: "canonical-1" };
      }
      if (method === "chat.history") return { messages: [] };
      return {};
    });
    const r = await ensureSessionsMessagesSubscribedForSend(mockClient(request), "sess-1");
    expect(r.eventsSubscribed).toBe(true);
    expect(subscribeCalls).toBe(2);
  });
});

describe("invalidateSessionSubscription", () => {
  beforeEach(() => {
    clearSessionSubscriptionTracking();
  });

  it("forces re-subscribe after invalidation", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.messages.subscribe") {
        return { subscribed: true, key: "k1" };
      }
      if (method === "chat.history") return { messages: [] };
      return {};
    });
    const client = mockClient(request);
    await ensureSessionsMessagesSubscribed(client, "k1");
    const afterFirst = request.mock.calls.filter(([m]) => m === "sessions.messages.subscribe").length;
    invalidateSessionSubscription("k1");
    await ensureSessionsMessagesSubscribed(client, "k1");
    const afterSecond = request.mock.calls.filter(([m]) => m === "sessions.messages.subscribe").length;
    expect(afterSecond).toBe(afterFirst + 1);
  });
});
