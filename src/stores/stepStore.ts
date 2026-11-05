import { create } from "zustand";
import { isChatPipelineCloseState } from "../lib/openclaw/chat-payload-terminal";
import {
  normalizeGatewayEvent,
  queueGatewayEventPersist,
} from "../lib/openclaw/gateway-event-persist";
import {
  advancePlanOnToolProgress,
} from "../lib/openclaw/task-orchestration";
import { useSessionStore } from "./sessionStore";
import type { PipelineStep } from "../types/pipeline-step";

/** OpenClaw 等网关常把生命周期放在 `payload.data.phase`，顶层无 phase */
function pickStatusPhaseState(payload: Record<string, unknown> | null): unknown {
  if (!payload) return undefined;
  const top = payload.status ?? payload.phase ?? payload.state;
  if (top != null && String(top).trim() !== "") return top;
  const d = payload.data;
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  return o.status ?? o.phase ?? o.state;
}

function collapseRunningSteps(
  steps: PipelineStep[],
  as: "success" | "skipped",
): PipelineStep[] {
  const now = new Date().toISOString();
  return steps.map((st) =>
    st.status === "running" ? { ...st, status: as, endedAt: now } : st,
  );
}

export type StepStore = {
  steps: PipelineStep[];
  activeAgentId: string | null;
  activeAgentName: string | null;
  /** 当前发送批次 ID，步骤事件绑定到此 ID */
  activeSendId: string | null;
  setActiveAgent: (agentId: string | null, agentName?: string | null) => void;
  beginSend: (sendId: string, initialSteps?: PipelineStep[]) => void;
  clear: () => void;
  /**
   * 将仍标记为 running 的步骤收口。
   * - success：正常终帧/工具结束
   * - skipped：中止、断连、致命错误（避免误显示「全部成功」）
   */
  finalizeStaleRunningSteps: (as?: "success" | "skipped") => void;
  /** 用持久化快照替换时间线（会话切换恢复，只读展示） */
  replaceSteps: (steps: PipelineStep[]) => void;
  ingestGatewayEvent: (event: string, payload: unknown) => void;
};

const MAX_TIMELINE_STEPS = 80;

export const useStepStore = create<StepStore>((set, get) => ({
  steps: [],
  activeAgentId: null,
  activeAgentName: null,
  activeSendId: null,

  setActiveAgent: (agentId, agentName) => set({ activeAgentId: agentId, activeAgentName: agentName ?? null }),

  beginSend: (sendId, initialSteps) =>
    set({ activeSendId: sendId, steps: initialSteps ? [...initialSteps] : [] }),

  clear: () => set({ steps: [], activeSendId: null }),

  finalizeStaleRunningSteps: (as = "success") =>
    set((state) => ({ steps: collapseRunningSteps(state.steps, as) })),

  replaceSteps: (steps) =>
    set({
      steps: steps.slice(0, MAX_TIMELINE_STEPS).map((st) => ({
        ...st,
        status: st.status === "running" ? ("success" as const) : st.status,
      })),
    }),

  ingestGatewayEvent: (event, payload) => {
    const norm = normalizeGatewayEvent(event, payload);
    if (!norm) return;

    const el = String(event).toLowerCase();
    const { sessionKey, messageId, toolCallId, runId, title, status, detail } = norm;
    const pObj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
    const streamLc = norm.streamKind ?? "";

    const terminalNonPending = status !== "running" && status !== "pending";
    const terminalToolByEventName = el.includes("tool") && terminalNonPending;
    const terminalSessionStreamFrame =
      el.startsWith("session.") &&
      terminalNonPending &&
      (streamLc === "tool" ||
        streamLc === "item" ||
        el === "session.item" ||
        el.endsWith(".item"));
    const chatStateForClose = pObj ? pickStatusPhaseState(pObj) : undefined;
    const isChatTurnClosed =
      (el === "chat" || el.endsWith(".chat")) && isChatPipelineCloseState(chatStateForClose);

    const collapsesStaleRunning =
      isChatTurnClosed || terminalToolByEventName || terminalSessionStreamFrame;

    const prev = collapsesStaleRunning ? collapseRunningSteps(get().steps, "success") : get().steps;
    const agentId = get().activeAgentId;
    const agentName = get().activeAgentName;
    const sendId = get().activeSendId ?? undefined;
    const sessionId = useSessionStore.getState().activeId ?? undefined;
    const nowIso = new Date().toISOString();
    queueGatewayEventPersist({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sessionId,
      sendId,
      sessionKey,
      messageId,
      eventName: event,
      payloadJson: JSON.stringify(payload ?? null).slice(0, 12_000),
      createdAt: nowIso,
    });
    const stepAgent = agentId ? { agentId, agentName: agentName ?? undefined } : {};

    const findExistingIndex = () => {
      if (toolCallId) {
        const byTool = prev.findIndex((st) => st.toolCallId === toolCallId);
        if (byTool >= 0) return byTool;
      }
      if (runId) {
        const byRun = prev.findIndex((st) => st.runId === runId);
        if (byRun >= 0) return byRun;
      }
      if (messageId) {
        const byMessage = prev.findIndex((st) => st.messageId === messageId);
        if (byMessage >= 0) return byMessage;
      }
      return -1;
    };

    const existingIdx = findExistingIndex();
    if (existingIdx >= 0) {
      const updated = [...prev];
      const existing = updated[existingIdx]!;
      updated[existingIdx] = {
        ...existing,
        title,
        status,
        detail,
        messageId: messageId ?? existing.messageId,
        runId: runId ?? existing.runId,
        toolCallId: toolCallId ?? existing.toolCallId,
        sessionKey: sessionKey ?? existing.sessionKey,
        endedAt: status === "running" || status === "pending" ? existing.endedAt : nowIso,
      };
      set({
        steps: advancePlanOnToolProgress(
          updated.length > MAX_TIMELINE_STEPS ? updated.slice(-MAX_TIMELINE_STEPS) : updated,
        ),
      });
      return;
    }

    const next = [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        title,
        status,
        kind: "tool" as const,
        toolCallId,
        runId,
        sendId,
        messageId,
        sessionKey,
        ...stepAgent,
        startedAt: nowIso,
        detail,
      },
    ];
    const merged = next.length > MAX_TIMELINE_STEPS ? next.slice(-MAX_TIMELINE_STEPS) : next;
    set({ steps: advancePlanOnToolProgress(merged) });
  },
}));
