import { describe, expect, it } from "vitest";
import { lifecycleLooksConnectable, shouldSkipHeavyGatewayPrep } from "./gateway-lifecycle";
import type { GatewayLifecycleSnapshot } from "./gateway-lifecycle";

function snap(
  partial: Partial<GatewayLifecycleSnapshot>,
): GatewayLifecycleSnapshot {
  return {
    phase: "starting",
    detail: "",
    at: new Date().toISOString(),
    establishComplete: true,
    establishWorkActive: false,
    processAlive: false,
    portReachable: false,
    processBusyLikely: false,
    wsConnectSuggested: false,
    externalConflict: false,
    bundledReady: true,
    supervisor: {
      supervised: false,
      pid: null,
      running: false,
      healthOk: false,
      message: "",
    },
    ...partial,
  };
}

describe("gateway-lifecycle", () => {
  it("connectable when healthy and ws suggested", () => {
    expect(
      lifecycleLooksConnectable(
        snap({ phase: "healthy", wsConnectSuggested: true, portReachable: true }),
      ),
    ).toBe(true);
  });

  it("connectable when port up and supervised process running", () => {
    expect(
      lifecycleLooksConnectable(
        snap({
          phase: "starting",
          wsConnectSuggested: false,
          portReachable: true,
          processAlive: true,
          supervisor: {
            supervised: true,
            pid: 1,
            running: true,
            healthOk: false,
            message: "",
          },
        }),
      ),
    ).toBe(true);
  });

  it("not connectable on external conflict", () => {
    expect(
      lifecycleLooksConnectable(
        snap({
          phase: "healthy",
          wsConnectSuggested: true,
          portReachable: true,
          externalConflict: true,
        }),
      ),
    ).toBe(false);
  });

  it("skips heavy prep while establish work thread is still active", () => {
    expect(
      shouldSkipHeavyGatewayPrep(
        snap({ establishComplete: true, establishWorkActive: true, externalConflict: true }),
      ),
    ).toBe(true);
  });
});
