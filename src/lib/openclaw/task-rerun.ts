import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import type { LocalTaskRow } from "../../stores/taskStore";
import { isTauriRuntime } from "../tauri-env";

export function parseReplayPrompt(task: LocalTaskRow): string | null {
  const raw = task.capabilitySnapshot?.trim();
  if (raw) {
    try {
      const o = JSON.parse(raw) as { replayPrompt?: unknown };
      if (typeof o.replayPrompt === "string" && o.replayPrompt.trim()) {
        return o.replayPrompt.trim();
      }
    } catch {
      /* ignore */
    }
  }
  const title = task.title?.trim();
  if (title && title !== "办事任务" && !title.startsWith("任务已")) return title;
  return null;
}

/** 打开关联会话并重发任务提示（失败/部分完成一键重跑）。 */
export async function rerunTask(task: LocalTaskRow): Promise<boolean> {
  if (!isTauriRuntime()) {
    useUiStore.getState().showToast("请在桌面版中重跑任务。", "info");
    return false;
  }
  const sid = task.sessionId?.trim();
  if (!sid) {
    useUiStore.getState().showToast("该任务未关联会话，无法重跑。", "info");
    return false;
  }
  const prompt = parseReplayPrompt(task);
  if (!prompt) {
    useUiStore.getState().showToast("未找到可重跑的任务内容。", "info");
    return false;
  }

  const sessions = useSessionStore.getState();
  if (sessions.isSending) {
    useUiStore.getState().showToast("当前有任务正在发送，请稍后再试。", "info");
    return false;
  }

  sessions.selectSession(sid);
  useUiStore.getState().requestNavToChat(sid);
  useUiStore.getState().requestOpenSidePanel();

  try {
    await sessions.sendMessage(prompt);
    useUiStore.getState().showToast("已重新发起任务", "success");
    return true;
  } catch (e) {
    useUiStore.getState().showToast(e instanceof Error ? e.message : String(e), "error");
    return false;
  }
}
