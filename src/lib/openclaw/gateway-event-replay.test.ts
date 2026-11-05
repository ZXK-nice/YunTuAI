import { describe, expect, it } from "vitest";
import { gatewayEventsToPipelineSteps } from "./gateway-event-replay";
import type { GatewayEventRow } from "./gateway-event-replay";

describe("gateway-event-replay", () => {
  it("merges tool events by toolCallId", () => {
    const rows: GatewayEventRow[] = [
      {
        id: "1",
        sessionId: "s1",
        sessionKey: "k1",
        messageId: null,
        sendId: "send-a",
        eventName: "session.tool",
        payloadJson: JSON.stringify({ toolCallId: "tc-1", name: "read", phase: "start" }),
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "2",
        sessionId: "s1",
        sessionKey: "k1",
        messageId: null,
        sendId: "send-a",
        eventName: "session.tool",
        payloadJson: JSON.stringify({ toolCallId: "tc-1", name: "read", phase: "end", ok: true }),
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ];
    const steps = gatewayEventsToPipelineSteps(rows, "send-a");
    expect(steps).toHaveLength(1);
    expect(steps[0]?.toolCallId).toBe("tc-1");
    expect(steps[0]?.status).toBe("success");
    expect(steps[0]?.endedAt).toBe("2026-01-01T00:00:01.000Z");
  });
});
