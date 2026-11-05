import { create } from "zustand";
import { isTauriRuntime } from "../lib/tauri-env";
import { invokeWithAuthRetry } from "../lib/tauri-invoke";
import type { TaskDeliverySummary } from "../lib/openclaw/task-delivery";

export type LocalTaskRow = {
  id: string;
  sessionId: string | null;
  title: string;
  status: string;
  templateId?: string | null;
  capabilitySnapshot?: string | null;
  outcome?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

type TaskStore = {
  recent: LocalTaskRow[];
  activeTaskIdBySession: Record<string, string>;
  loading: boolean;
  loadRecent: (limit?: number) => Promise<void>;
  loadLatestForSession: (sessionId: string) => Promise<LocalTaskRow | null>;
  beginTaskForSession: (
    sessionId: string,
    title: string,
    opts?: { templateId?: string; capabilitySnapshot?: string },
  ) => Promise<LocalTaskRow | null>;
  completeActiveTask: (
    sessionId: string,
    summary: TaskDeliverySummary,
  ) => Promise<LocalTaskRow | null>;
  clearSession: (sessionId: string) => void;
  resetForLogout: () => void;
};

export function statusFromDelivery(summary: TaskDeliverySummary): string {
  if (summary.outcome === "cancelled") return "cancelled";
  if (summary.outcome === "failed") return "failed";
  if (summary.outcome === "partial") return "partial";
  return "completed";
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  recent: [],
  activeTaskIdBySession: {},
  loading: false,

  loadRecent: async (limit = 20) => {
    if (!isTauriRuntime()) return;
    set({ loading: true });
    try {
      const rows = await invokeWithAuthRetry<LocalTaskRow[]>("db_list_tasks", {
        limit,
        sessionId: null,
      });
      set({ recent: rows ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadLatestForSession: async (sessionId) => {
    if (!isTauriRuntime() || !sessionId.trim()) return null;
    try {
      const rows = await invokeWithAuthRetry<LocalTaskRow[]>("db_list_tasks", {
        limit: 1,
        sessionId,
      });
      return rows?.[0] ?? null;
    } catch {
      return null;
    }
  },

  beginTaskForSession: async (sessionId, title, opts) => {
    if (!isTauriRuntime() || !sessionId.trim()) return null;
    try {
      const row = await invokeWithAuthRetry<LocalTaskRow>("db_create_task", {
        title: title.trim().slice(0, 200) || "办事任务",
        sessionId,
        templateId: opts?.templateId ?? null,
        capabilitySnapshot: opts?.capabilitySnapshot ?? null,
      });
      if (!row) return null;
      set((s) => ({
        activeTaskIdBySession: { ...s.activeTaskIdBySession, [sessionId]: row.id },
        recent: [row, ...s.recent.filter((t) => t.id !== row.id)].slice(0, 40),
      }));
      return row;
    } catch {
      return null;
    }
  },

  completeActiveTask: async (sessionId, summary) => {
    if (!isTauriRuntime() || !sessionId.trim()) return null;
    const taskId = get().activeTaskIdBySession[sessionId];
    const status = statusFromDelivery(summary);
    const outcomeJson = JSON.stringify(summary);

    try {
      // 无活跃任务时不新建行，避免 WS final + sendMessage 双路径 finalize 产生重复任务
      if (!taskId) return null;
      const row = await invokeWithAuthRetry<LocalTaskRow>("db_update_task_status", {
        taskId,
        status,
        outcome: outcomeJson,
      });
      if (!row) return null;
      set((s) => {
        const nextActive = { ...s.activeTaskIdBySession };
        delete nextActive[sessionId];
        return {
          activeTaskIdBySession: nextActive,
          recent: [row, ...s.recent.filter((t) => t.id !== row.id)].slice(0, 40),
        };
      });
      return row;
    } catch {
      return null;
    }
  },

  resetForLogout: () => set({ recent: [], activeTaskIdBySession: {}, loading: false }),

  clearSession: (sessionId) => {
    if (!sessionId.trim()) return;
    set((s) => {
      const nextActive = { ...s.activeTaskIdBySession };
      delete nextActive[sessionId];
      return {
        activeTaskIdBySession: nextActive,
        recent: s.recent.filter((t) => t.sessionId !== sessionId),
      };
    });
  },
}));
