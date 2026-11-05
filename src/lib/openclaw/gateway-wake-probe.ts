import { connectWithFeedback } from "../connect-with-feedback";
import { getGatewayClient } from "./gateway-runtime";
import {
  endGatewayRecovery,
  isGatewayRecoveryInFlight,
  tryBeginGatewayRecoveryOrSchedule,
} from "./gateway-recovery-lock";
import { isInStartupGrace } from "./gateway-recovery";
import { getLaunchConnectProfile } from "./launch-connect-profile";
import type { GatewayStoreSlice } from "./gateway-wake-probe-types";

/** 连续失败次数达到后才 disconnect+重连，避免单次 health 超时误杀长推理后的连接 */
export const WAKE_PROBE_FAILS_BEFORE_RECONNECT = 2;

export type WakeProbeState = {
  lastWakeProbeAt: number;
  wakeProbeFailStreak: number;
};

export type RunGatewayWakeProbeOpts = {
  now?: number;
  state: WakeProbeState;
  gateway: GatewayStoreSlice;
  isSending: boolean;
  connectWithFeedbackFn?: typeof connectWithFeedback;
  healthCheck?: () => Promise<void>;
  beginRecovery?: typeof tryBeginGatewayRecoveryOrSchedule;
  endRecovery?: typeof endGatewayRecovery;
  recoveryInFlight?: () => boolean;
};

/** 休眠唤醒 / 回前台 / 网络恢复后的网关探活（可单测）。 */
export async function runGatewayWakeProbe(opts: RunGatewayWakeProbeOpts): Promise<WakeProbeState> {
  const now = opts.now ?? Date.now();
  const cooldownMs = getLaunchConnectProfile().wakeProbeCooldownMs;
  const connect = opts.connectWithFeedbackFn ?? connectWithFeedback;
  const beginRecovery = opts.beginRecovery ?? tryBeginGatewayRecoveryOrSchedule;
  const endRecovery = opts.endRecovery ?? endGatewayRecovery;
  const recoveryInFlight = opts.recoveryInFlight ?? isGatewayRecoveryInFlight;

  if (now - opts.state.lastWakeProbeAt < cooldownMs) {
    return opts.state;
  }
  if (recoveryInFlight()) {
    return { ...opts.state, lastWakeProbeAt: now };
  }

  let next: WakeProbeState = { ...opts.state, lastWakeProbeAt: now };
  const gw = opts.gateway;

  if (opts.isSending) {
    return next;
  }

  if (gw.connState !== "connected") {
    next = { ...next, wakeProbeFailStreak: 0 };
    if (gw.autoReconnect) {
      void connect("唤醒后重连本机服务", {
        skipPrepare: isInStartupGrace(),
        fastReopen: !isInStartupGrace(),
      });
    }
    return next;
  }

  const healthCheck =
    opts.healthCheck ??
    (async () => {
      const client = getGatewayClient();
      await client.request("health", {}, { timeoutMs: 5_000 });
    });

  try {
    await healthCheck();
    return { ...next, wakeProbeFailStreak: 0 };
  } catch {
    const streak = next.wakeProbeFailStreak + 1;
    if (streak < WAKE_PROBE_FAILS_BEFORE_RECONNECT) {
      return { ...next, wakeProbeFailStreak: streak };
    }

    const runWakeRecovery = async () => {
      if (!beginRecovery(runWakeRecovery)) return;
      try {
        gw.cancelReconnect();
        gw.disconnect();
        await connect("唤醒后恢复本机服务", { skipPrepare: true });
      } finally {
        endRecovery();
      }
    };
    await runWakeRecovery();
    return { ...next, wakeProbeFailStreak: 0 };
  }
}
