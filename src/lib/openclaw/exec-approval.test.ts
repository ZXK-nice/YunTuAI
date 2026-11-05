import { describe, expect, it } from "vitest";
import { computeApprovalSnoozeUntil, parseExecApprovalRequested } from "./exec-approval";

describe("parseExecApprovalRequested", () => {
  it("parses valid exec approval payload", () => {
    const parsed = parseExecApprovalRequested({
      id: "a1",
      createdAtMs: 1000,
      expiresAtMs: 60_000,
      request: { command: "rm -rf /tmp/foo", cwd: "C:\\work" },
    });
    expect(parsed?.id).toBe("a1");
    expect(parsed?.request.command).toBe("rm -rf /tmp/foo");
    expect(parsed?.request.cwd).toBe("C:\\work");
  });

  it("returns null without command", () => {
    expect(parseExecApprovalRequested({ id: "x", createdAtMs: 1, expiresAtMs: 2, request: {} })).toBeNull();
  });
});

describe("computeApprovalSnoozeUntil", () => {
  it("caps snooze at 3 minutes when expiry is far away", () => {
    const now = 1_000_000;
    expect(computeApprovalSnoozeUntil(now, now + 30 * 60_000)).toBe(now + 3 * 60_000);
  });

  it("wakes before gateway expiry with a 10s buffer", () => {
    const now = 1_000_000;
    const expires = now + 90_000;
    expect(computeApprovalSnoozeUntil(now, expires)).toBe(expires - 10_000);
  });

  it("returns null when remaining time is too close to expiry", () => {
    const now = 1_000_000;
    expect(computeApprovalSnoozeUntil(now, now + 8_000)).toBeNull();
    expect(computeApprovalSnoozeUntil(now, now + 10_000)).toBeNull();
  });
});
