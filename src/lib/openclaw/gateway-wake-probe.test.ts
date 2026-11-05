import { describe, expect, it, vi } from "vitest";
import {
  runGatewayWakeProbe,
  WAKE_PROBE_FAILS_BEFORE_RECONNECT,
  type WakeProbeState,
} from "./gateway-wake-probe";

vi.mock("./launch-connect-profile", () => ({
  getLaunchConnectProfile: () => ({ wakeProbeCooldownMs: 8_000 }),
}));

vi.mock("./gateway-recovery", () => ({
  isInStartupGrace: () => true,
}));

describe("runGatewayWakeProbe", () => {
  const baseState: WakeProbeState = { lastWakeProbeAt: 0, wakeProbeFailStreak: 0 };

  it("skips probe during cooldown", async () => {
    const out = await runGatewayWakeProbe({
      now: 5_000,
      state: { lastWakeProbeAt: 1_000, wakeProbeFailStreak: 0 },
      gateway: {
        connState: "connected",
        autoReconnect: true,
        cancelReconnect: vi.fn(),
        disconnect: vi.fn(),
      },
      isSending: false,
      healthCheck: vi.fn(),
    });
    expect(out.lastWakeProbeAt).toBe(1_000);
  });

  it("reconnects when disconnected and autoReconnect enabled", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    await runGatewayWakeProbe({
      now: 10_000,
      state: baseState,
      gateway: {
        connState: "error",
        autoReconnect: true,
        cancelReconnect: vi.fn(),
        disconnect: vi.fn(),
      },
      isSending: false,
      connectWithFeedbackFn: connect,
      healthCheck: vi.fn(),
    });
    expect(connect).toHaveBeenCalledWith(
      "唤醒后重连本机服务",
      expect.objectContaining({ skipPrepare: true }),
    );
  });

  it("recovers after consecutive health failures", async () => {
    const disconnect = vi.fn();
    const cancelReconnect = vi.fn();
    const connect = vi.fn().mockResolvedValue(undefined);
    const healthCheck = vi.fn().mockRejectedValue(new Error("timeout"));
    const beginRecovery = vi.fn().mockReturnValue(true);
    const endRecovery = vi.fn();

    let state = baseState;
    for (let i = 0; i < WAKE_PROBE_FAILS_BEFORE_RECONNECT; i++) {
      state = await runGatewayWakeProbe({
        now: 10_000 + i * 9_000,
        state,
        gateway: {
          connState: "connected",
          autoReconnect: true,
          cancelReconnect,
          disconnect,
        },
        isSending: false,
        connectWithFeedbackFn: connect,
        healthCheck,
        beginRecovery,
        endRecovery,
      });
    }

    expect(disconnect).toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith("唤醒后恢复本机服务", { skipPrepare: true });
    expect(endRecovery).toHaveBeenCalled();
    expect(state.wakeProbeFailStreak).toBe(0);
  });

  it("does not probe while sending", async () => {
    const healthCheck = vi.fn();
    await runGatewayWakeProbe({
      now: 20_000,
      state: baseState,
      gateway: {
        connState: "connected",
        autoReconnect: true,
        cancelReconnect: vi.fn(),
        disconnect: vi.fn(),
      },
      isSending: true,
      healthCheck,
    });
    expect(healthCheck).not.toHaveBeenCalled();
  });
});
