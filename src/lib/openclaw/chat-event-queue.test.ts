import { describe, expect, it } from "vitest";
import { resetChatEventQueues, runQueuedChatEvent } from "./chat-event-queue";

describe("chat-event-queue", () => {
  it("serializes events for the same session key", async () => {
    resetChatEventQueues();
    const order: number[] = [];
    const first = runQueuedChatEvent("sess-a", async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
    });
    const second = runQueuedChatEvent("sess-a", async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
    resetChatEventQueues();
  });
});
