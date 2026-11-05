export type NavKey =
  | "dashboard"
  | "sessions"
  | "agents"
  | "skillStudio"
  | "imageStudio"
  | "meetingAssistant"
  | "settings"
  | "logs"
  | "advanced";

/** 会议助手已下架：残留导航一律回对话。 */
export function resolveAppNav(nav: NavKey): NavKey {
  return nav === "meetingAssistant" ? "sessions" : nav;
}
