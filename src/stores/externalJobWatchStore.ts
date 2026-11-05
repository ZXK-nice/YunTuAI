import { create } from "zustand";

export type ExternalJobWatch = {
  id: string;
  sessionId: string;
  parentSendId: string;
  parentLabel: string;
  jobId: string;
  status: string;
  totalItems?: number;
  completedItems?: number;
  failedItems?: number;
  startedAt: string;
  lastPollAt?: string;
  endedAt?: string;
};

type ExternalJobWatchState = {
  watches: ExternalJobWatch[];
  beginWatch: (watch: Omit<ExternalJobWatch, "status" | "startedAt">) => string;
  patchWatch: (id: string, patch: Partial<ExternalJobWatch>) => void;
  finishWatch: (id: string, status: string) => void;
  clearSession: (sessionId: string) => void;
  getActiveForSession: (sessionId: string) => ExternalJobWatch[];
};

const MAX_WATCHES = 16;

export const useExternalJobWatchStore = create<ExternalJobWatchState>((set, get) => ({
  watches: [],

  beginWatch: (watch) => {
    const now = new Date().toISOString();
    const entry: ExternalJobWatch = {
      ...watch,
      status: "polling",
      startedAt: now,
    };
    set((s) => ({
      watches: [entry, ...s.watches.filter((w) => w.id !== watch.id)].slice(0, MAX_WATCHES),
    }));
    return watch.id;
  },

  patchWatch: (id, patch) => {
    set((s) => ({
      watches: s.watches.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  },

  finishWatch: (id, status) => {
    const now = new Date().toISOString();
    set((s) => ({
      watches: s.watches.map((w) =>
        w.id === id ? { ...w, status, endedAt: now, lastPollAt: now } : w,
      ),
    }));
  },

  clearSession: (sessionId) => {
    set((s) => ({
      watches: s.watches.filter((w) => w.sessionId !== sessionId),
    }));
  },

  getActiveForSession: (sessionId) => {
    return get().watches.filter((w) => w.sessionId === sessionId && !w.endedAt);
  },
}));
