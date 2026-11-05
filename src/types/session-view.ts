import type { NavKey } from "./app-nav";

/** 主工作区内「对话 / 工具」子视图（顶栏标签切换） */
export type SessionSubView = "chat" | "tools";

/** 顶栏主界面：不展示右侧任务进度栏 */
export function isMainHubView(nav: NavKey, sessionSubView: SessionSubView): boolean {
  return (
    nav === "agents" ||
    nav === "skillStudio" ||
    nav === "imageStudio" ||
    nav === "meetingAssistant" ||
    (nav === "sessions" && (sessionSubView === "chat" || sessionSubView === "tools"))
  );
}
