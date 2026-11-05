/** 侧栏会话时间：当天显示时分以便区分；更早显示日期。 */
export function formatSessionSidebarTime(updatedAt: string, nowMs = Date.now()): string {
  const n = Number(updatedAt);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n);
  const now = new Date(nowMs);
  const diffMs = Math.max(0, nowMs - n);

  if (diffMs < 45_000) return "刚刚";

  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }

  const y = d.getFullYear();
  const cy = now.getFullYear();
  if (y === cy) {
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" });
}
