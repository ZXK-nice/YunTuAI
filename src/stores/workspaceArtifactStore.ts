import { create } from "zustand";
import {
  extractWorkspaceArtifacts,
  mergeArtifacts,
  type WorkspaceArtifact,
} from "../lib/openclaw/workspace-artifacts";

type WorkspaceArtifactState = {
  bySession: Record<string, WorkspaceArtifact[]>;
  ingestGatewayEvent: (sessionId: string | null, event: string, payload: unknown) => void;
  clearSession: (sessionId: string) => void;
  clearAll: () => void;
};

export const useWorkspaceArtifactStore = create<WorkspaceArtifactState>((set) => ({
  bySession: {},

  ingestGatewayEvent: (sessionId, event, payload) => {
    if (!sessionId) return;
    const found = extractWorkspaceArtifacts(event, payload);
    if (found.length === 0) return;
    set((s) => {
      const prev = s.bySession[sessionId] ?? [];
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: mergeArtifacts(prev, found),
        },
      };
    });
  },

  clearSession: (sessionId) => {
    void import("../lib/openclaw/task-delivery")
      .then((m) => m.clearTaskDeliverySummary(sessionId))
      .catch(() => undefined);
    set((s) => {
      if (!s.bySession[sessionId]) return s;
      const next = { ...s.bySession };
      delete next[sessionId];
      return { bySession: next };
    });
  },

  clearAll: () => set({ bySession: {} }),
}));

export function artifactsForSession(sessionId: string | null): WorkspaceArtifact[] {
  if (!sessionId) return [];
  return useWorkspaceArtifactStore.getState().bySession[sessionId] ?? [];
}
