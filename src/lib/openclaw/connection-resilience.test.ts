import { describe, expect, it } from "vitest";
import {
  connectFailureReconnectDelayMs,
  humanizeGatewaySendError,
  isGatewayAuthError,
  isGatewayRateLimitedError,
  isSessionFileLockedError,
  isSupervisorGatewayOperational,
  isTransientGatewaySendError,
  reconnectBackoffMs,
  SESSION_FILE_LOCKED_HINT,
} from "./connection-resilience";

describe("connection-resilience", () => {
  it("detects rate_limited handshake errors", () => {
    expect(
      isGatewayRateLimitedError(
        "服务拒绝握手 (1008): unauthorized: too many failed authentication attempts (retry later)",
      ),
    ).toBe(true);
    expect(isGatewayRateLimitedError("连接在握手完成前关闭")).toBe(false);
  });

  it("detects auth token errors", () => {
    expect(isGatewayAuthError("AUTH_TOKEN_MISSING")).toBe(true);
    expect(isGatewayAuthError("握手超时")).toBe(false);
  });

  it("detects transient send errors but not auth/rate-limit", () => {
    expect(isTransientGatewaySendError("WebSocket connection closed")).toBe(true);
    expect(isTransientGatewaySendError("ECONNRESET")).toBe(true);
    expect(isTransientGatewaySendError("503 Service Unavailable")).toBe(true);
    expect(isTransientGatewaySendError("rate_limited")).toBe(false);
    expect(isTransientGatewaySendError("AUTH_TOKEN_MISSING")).toBe(false);
  });

  it("returns longer delay for rate limit", () => {
    const d0 = connectFailureReconnectDelayMs("rate_limited", 0);
    const d2 = connectFailureReconnectDelayMs("rate_limited", 2);
    expect(d0).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d2!).toBeGreaterThanOrEqual(d0!);
    expect(connectFailureReconnectDelayMs("握手超时", 0)).toBeNull();
  });

  it("rate-limited backoff exceeds normal backoff", () => {
    expect(reconnectBackoffMs(0, { rateLimited: true })).toBeGreaterThan(reconnectBackoffMs(0));
  });

  it("treats supervised running gateway as operational without healthOk", () => {
    expect(
      isSupervisorGatewayOperational({
        supervised: true,
        running: true,
        healthOk: false,
        pid: 1,
        message: "ok",
      }),
    ).toBe(true);
    expect(
      isSupervisorGatewayOperational({
        supervised: true,
        running: true,
        healthOk: false,
        pid: 1,
        message: "ok",
      }, { requireHealthOk: true }),
    ).toBe(false);
    expect(isSupervisorGatewayOperational(null)).toBe(false);
  });

  it("humanizes context limit errors", () => {
    expect(humanizeGatewaySendError("maximum context length exceeded")).toContain("压缩上下文");
    expect(humanizeGatewaySendError("maximum context length exceeded")).toContain("换用更大上下文的模型");
  });

  it("humanizes session file locked errors", () => {
    expect(isSessionFileLockedError("session file locked (timeout 60000ms)")).toBe(true);
    expect(humanizeGatewaySendError("session file locked (timeout 60000ms)")).toBe(
      SESSION_FILE_LOCKED_HINT,
    );
    expect(isSessionFileLockedError("network error")).toBe(false);
  });

  it("reconnectBackoffMs grows with attempt and stays bounded", () => {
    const a0 = reconnectBackoffMs(0);
    const a3 = reconnectBackoffMs(3);
    const a9 = reconnectBackoffMs(9);
    expect(a3).toBeGreaterThanOrEqual(a0);
    expect(a9).toBeLessThanOrEqual(10_000);
  });
});
