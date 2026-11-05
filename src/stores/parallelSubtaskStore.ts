import { create } from "zustand";
import type { StepStatus } from "../types/pipeline-step";

export type ParallelSubtaskEntry = {
  id: string;
  title: string;
  status: StepStatus;
  excerpt?: string;
  startedAt?: string;
  endedAt?: string;
};

export type ParallelSubtaskRun = {
  id: string;
  sessionId: string;
  parentSendId: string;
  parentLabel: string;
  items: ParallelSubtaskEntry[];
  startedAt: string;
  endedAt?: string;
};

type ParallelSubtaskState = {
  runs: ParallelSubtaskRun[];
  beginRun: (run: Omit<ParallelSubtaskRun, "startedAt" | "items"> & { items: { id: string; title: string }[] }) => string;
  patchItem: (runId: string, itemId: string, patch: Partial<ParallelSubtaskEntry>) => void;
  finishRun: (runId: string) => void;
  clearSession: (sessionId: string) => void;
  getActiveForSession: (sessionId: string) => ParallelSubtaskRun | null;
};

const MAX_RUNS = 12;

export const useParallelSubtaskStore = create<ParallelSubtaskState>((set, get) => ({
  runs: [],

  beginRun: (run) => {
    const now = new Date().toISOString();
    const id = run.id || `pr-${Date.now()}`;
    const entry: ParallelSubtaskRun = {
      id,
      sessionId: run.sessionId,
      parentSendId: run.parentSendId,
      parentLabel: run.parentLabel,
      startedAt: now,
      items: run.items.map((it) => ({
        id: it.id,
        title: it.title,
        status: "pending",
      })),
    };
    set((s) => ({
      runs: [entry, ...s.runs.filter((r) => r.id !== id)].slice(0, MAX_RUNS),
    }));
    return id;
  },

  patchItem: (runId, itemId, patch) => {
    set((s) => ({
      runs: s.runs.map((run) => {
        if (run.id !== runId) return run;
        return {
          ...run,
          items: run.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        };
      }),
    }));
  },

  finishRun: (runId) => {
    const now = new Date().toISOString();
    set((s) => ({
      runs: s.runs.map((run) => (run.id === runId ? { ...run, endedAt: now } : run)),
    }));
  },

  clearSession: (sessionId) => {
    set((s) => ({ runs: s.runs.filter((r) => r.sessionId !== sessionId) }));
  },

  getActiveForSession: (sessionId) => {
    const runs = get().runs.filter((r) => r.sessionId === sessionId);
    return runs.find((r) => !r.endedAt && r.items.some((it) => it.status === "running" || it.status === "pending")) ?? runs[0] ?? null;
  },
}));
