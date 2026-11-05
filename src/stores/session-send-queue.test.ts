import { describe, expect, it } from "vitest";
import {
  clearQueuedDisconnectedSend,
  enqueueDisconnectedSend,
  hasQueuedDisconnectedSend,
  peekQueuedDisconnectedSend,
  takeQueuedDisconnectedSend,
} from "./session-send-queue";

describe("session-send-queue", () => {
  it("enqueues, peeks, and takes once", () => {
    clearQueuedDisconnectedSend();
    enqueueDisconnectedSend({ sessionId: "s1", input: "hello" });
    expect(hasQueuedDisconnectedSend()).toBe(true);
    expect(peekQueuedDisconnectedSend()?.sessionId).toBe("s1");
    expect(takeQueuedDisconnectedSend()?.input).toBe("hello");
    expect(hasQueuedDisconnectedSend()).toBe(false);
    expect(takeQueuedDisconnectedSend()).toBeNull();
  });
});
