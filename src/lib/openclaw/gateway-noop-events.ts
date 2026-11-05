/**
 * 网关周期性心跳/保活事件：不应进入任务进度时间线，也不应延长「等回复」空闲计时。
 */
export function isGatewayNoopEvent(event: string): boolean {
  const el = String(event).toLowerCase().trim();
  if (!el) return true;

  if (
    el === "heartbeat" ||
    el === "pulse" ||
    el === "gateway.pulse" ||
    el === "tick" ||
    el === "agent.tick" ||
    el === "session.tick" ||
    el === "run.tick" ||
    el === "cron.tick" ||
    el === "status" ||
    el === "health" ||
    el === "presence" ||
    // sessions.changed 仍由 gatewayStore.onEvent 单独处理；此处仅避免延长等回复计时
    el === "sessions.changed" ||
    el === "index.changed"
  ) {
    return true;
  }

  if (
    el.endsWith(".tick") ||
    el.endsWith(".pulse") ||
    el.endsWith(".heartbeat") ||
    el.endsWith(".changed")
  ) {
    return true;
  }

  if (el.startsWith("index.")) return true;

  return false;
}
