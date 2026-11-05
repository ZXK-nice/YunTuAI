import type { PipelineStep } from "../../types/pipeline-step";
import type { MeetingLiveState } from "./meeting-bridge";
import { useSessionStore } from "../../stores/sessionStore";
import { useStepStore } from "../../stores/stepStore";
import { useTaskStore } from "../../stores/taskStore";
import { useUiStore } from "../../stores/uiStore";

export function collectMeetingActionItems(live: MeetingLiveState): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const digest of live.digests) {
    for (const item of digest.actionItems) {
      const t = item.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** 将会议阶段整理中的待办写入任务侧栏（计划步骤，不自动发消息）。 */
export async function pushMeetingTodosToTaskPanel(live: MeetingLiveState): Promise<number> {
  const items = collectMeetingActionItems(live);
  if (items.length === 0) return 0;

  const sessionStore = useSessionStore.getState();
  let sessionId = sessionStore.activeId;
  if (!sessionId) {
    await sessionStore.createSession();
    sessionId = useSessionStore.getState().activeId;
  }
  if (!sessionId) return 0;

  await useTaskStore.getState().beginTaskForSession(
    sessionId,
    `会议待办 · ${live.session.title}`.slice(0, 80),
    { templateId: "meeting-notes" },
  );

  const steps: PipelineStep[] = items.map((title, i) => ({
    id: `meeting-todo-${live.session.id}-${i}`,
    title,
    status: "pending",
    kind: "plan",
  }));
  useStepStore.getState().replaceSteps(steps);
  useUiStore.getState().requestOpenSidePanel();
  return items.length;
}
