import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("./tauri-env", () => ({
  isTauriRuntime: () => true,
}));

import {
  hasSkippedFirstRunGatewayGate,
  isFirstRunGatewayPending,
  skipFirstRunGatewayGate,
  markGatewayEverConnected,
} from "./first-run-gateway";

describe("first-run-gateway", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("missing skip timestamp expires skip flag", () => {
    localStorage.setItem("yuntuai.firstRunGatewaySkipped", "1");
    expect(hasSkippedFirstRunGatewayGate()).toBe(false);
  });

  it("skip expires after TTL when gateway never connected", () => {
    skipFirstRunGatewayGate();
    expect(hasSkippedFirstRunGatewayGate()).toBe(true);

    const key = "yuntuai.firstRunGatewaySkippedAt";
    const at = localStorage.getItem(key);
    expect(at).toBeTruthy();
    const past = String(Date.now() - 8 * 24 * 60 * 60 * 1000);
    localStorage.setItem(key, past);

    expect(hasSkippedFirstRunGatewayGate()).toBe(false);
    expect(isFirstRunGatewayPending()).toBe(true);
  });

  it("connected clears skip", () => {
    skipFirstRunGatewayGate();
    markGatewayEverConnected();
    expect(hasSkippedFirstRunGatewayGate()).toBe(false);
    expect(isFirstRunGatewayPending()).toBe(false);
  });
});
