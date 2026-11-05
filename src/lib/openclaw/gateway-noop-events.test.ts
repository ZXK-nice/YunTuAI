import { describe, expect, it } from "vitest";
import { isGatewayNoopEvent } from "./gateway-noop-events";

describe("gateway-noop-events", () => {
  it("treats tick and heartbeat as noop", () => {
    expect(isGatewayNoopEvent("tick")).toBe(true);
    expect(isGatewayNoopEvent("agent.tick")).toBe(true);
    expect(isGatewayNoopEvent("heartbeat")).toBe(true);
    expect(isGatewayNoopEvent("gateway.pulse")).toBe(true);
  });

  it("keeps tool and chat events actionable", () => {
    expect(isGatewayNoopEvent("session.tool")).toBe(false);
    expect(isGatewayNoopEvent("chat")).toBe(false);
    expect(isGatewayNoopEvent("session.item")).toBe(false);
  });
});
