export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

export function latencyToQuality(ms: number | null | undefined): ConnectionQuality {
  if (ms == null || !Number.isFinite(ms)) return "unknown";
  if (ms < 250) return "good";
  if (ms < 900) return "fair";
  return "poor";
}

export function qualityLabel(q: ConnectionQuality): string {
  switch (q) {
    case "good":
      return "连接良好";
    case "fair":
      return "连接一般";
    case "poor":
      return "连接较慢";
    default:
      return "测量中";
  }
}

export function qualityDotClass(q: ConnectionQuality): string {
  switch (q) {
    case "good":
      return "app-header-status-dot app-header-status-dot--good";
    case "fair":
      return "app-header-status-dot app-header-status-dot--fair";
    case "poor":
      return "app-header-status-dot app-header-status-dot--poor";
    default:
      return "app-header-status-dot app-header-status-dot--muted";
  }
}

export function connStatusDotClass(connState: string, connected: boolean): string {
  if (connected) return "app-header-status-dot app-header-status-dot--good";
  if (connState === "connecting") {
    return "app-header-status-dot app-header-status-dot--fair app-header-status-dot--pulse";
  }
  if (connState === "error" || connState === "disconnected") {
    return "app-header-status-dot app-header-status-dot--poor";
  }
  return "app-header-status-dot app-header-status-dot--muted";
}
