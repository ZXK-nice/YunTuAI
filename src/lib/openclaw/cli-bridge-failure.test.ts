import { describe, expect, it, beforeEach } from "vitest";
import {
  clearLastCliBridgeFailure,
  getLastCliBridgeFailure,
} from "./cli-bridge";
import { buildConnectionDiagnosticsSummary } from "./connection-diagnostics";

describe("cli-bridge failure tracking", () => {
  beforeEach(() => {
    clearLastCliBridgeFailure();
  });

  it("starts with no failure recorded", () => {
    expect(getLastCliBridgeFailure()).toBeNull();
  });
});

describe("buildConnectionDiagnosticsSummary ipc failure", () => {
  beforeEach(() => {
    clearLastCliBridgeFailure();
  });

  it("omits ipc line when no failure", () => {
    const text = buildConnectionDiagnosticsSummary({
      connState: "disconnected",
      wsUrl: "ws://127.0.0.1:18789",
      lastError: null,
      serverInfo: null,
      healthLatencyMs: null,
      reconnectAttempt: 0,
      connectionQuality: "unknown",
      capabilities: null,
      methodCoverage: null,
      activeSession: null,
      distributionProfile: null,
    });
    expect(text).not.toContain("最近 IPC 失败");
  });
});
