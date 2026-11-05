/** 全局单飞：唤醒探活、supervisor unhealthy、stall 恢复等勿并行 disconnect+重连。 */
let recoveryInFlight = false;
let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

export function tryBeginGatewayRecovery(): boolean {
  if (recoveryInFlight) return false;
  recoveryInFlight = true;
  if (recoveryRetryTimer) {
    clearTimeout(recoveryRetryTimer);
    recoveryRetryTimer = null;
  }
  return true;
}

/** 若已有恢复在进行中，3s 后自动重试一次（避免多源触发时漏恢复）。 */
export function tryBeginGatewayRecoveryOrSchedule(retry: () => void): boolean {
  if (tryBeginGatewayRecovery()) return true;
  if (!recoveryRetryTimer) {
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = null;
      retry();
    }, 3_000);
  }
  return false;
}

export function endGatewayRecovery(): void {
  recoveryInFlight = false;
}

export function isGatewayRecoveryInFlight(): boolean {
  return recoveryInFlight;
}
