import { describe, expect, it } from "vitest";
import { formatSessionSidebarTime } from "./session-sidebar-time";

describe("formatSessionSidebarTime", () => {
  const now = new Date("2026-07-15T11:03:00+08:00").getTime();

  it("shows relative time only within 45 seconds", () => {
    expect(formatSessionSidebarTime(String(now - 30_000), now)).toBe("刚刚");
    expect(formatSessionSidebarTime(String(now - 50_000), now)).toMatch(/10:5|11:0/);
  });

  it("shows clock time for earlier today instead of N minutes ago", () => {
    const fiveMinAgo = now - 5 * 60_000;
    expect(formatSessionSidebarTime(String(fiveMinAgo), now)).toMatch(/10:5|11:0/);
  });

  it("shows clock time for earlier today", () => {
    const morning = new Date("2026-07-15T08:30:00+08:00").getTime();
    expect(formatSessionSidebarTime(String(morning), now)).toMatch(/8:30|08:30/);
  });

  it("shows month/day for this year", () => {
    const june = new Date("2026-06-27T10:00:00+08:00").getTime();
    expect(formatSessionSidebarTime(String(june), now)).toMatch(/6\/27|6-27|27/);
  });
});
