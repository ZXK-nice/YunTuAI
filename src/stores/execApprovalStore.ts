import { create } from "zustand";
import {
  computeApprovalSnoozeUntil,
  fetchPendingApprovals,
  parseExecApprovalRequested,
  parsePluginApprovalRequested,
  pruneExecApprovalQueue,
  resolveExecApproval,
  type ExecApprovalDecision,
  type ExecApprovalRequest,
} from "../lib/openclaw/exec-approval";
import { checkBlockedPackageInstall } from "../lib/openclaw/exec-package-guard";
import { getGatewayClient } from "../lib/openclaw/gateway-runtime";

type ExecApprovalState = {
  queue: ExecApprovalRequest[];
  /** 审批 id → 再次展示时间戳 */
  snoozedUntil: Record<string, number>;
  busy: boolean;
  error: string | null;
  enqueue: (entry: ExecApprovalRequest) => void;
  remove: (id: string) => void;
  /** 成功挂起返回 true；距过期太近无法稍后返回 false（弹窗保持打开）。 */
  defer: (id: string) => boolean;
  clearExpiredSnoozes: () => void;
  selectActive: () => ExecApprovalRequest | null;
  refresh: () => Promise<void>;
  resolve: (id: string, decision: ExecApprovalDecision) => Promise<void>;
  handleGatewayEvent: (event: string, payload: unknown) => void;
};

function addUnique(queue: ExecApprovalRequest[], entry: ExecApprovalRequest): ExecApprovalRequest[] {
  const next = pruneExecApprovalQueue(queue).filter((e) => e.id !== entry.id);
  next.unshift(entry);
  return next;
}

export const useExecApprovalStore = create<ExecApprovalState>((set, get) => ({
  queue: [],
  snoozedUntil: {},
  busy: false,
  error: null,

  enqueue: (entry) => {
    if (entry.kind === "exec") {
      const blocked = checkBlockedPackageInstall(entry.request.command);
      if (blocked) {
        const client = getGatewayClient();
        if (client.isHelloOk) {
          void resolveExecApproval(
            (m, p) => client.request(m, p),
            entry.id,
            "deny",
            entry.kind,
          ).catch(() => undefined);
        }
        return;
      }
    }
    set((s) => {
      const snoozedUntil = { ...s.snoozedUntil };
      delete snoozedUntil[entry.id];
      return { queue: addUnique(s.queue, entry), snoozedUntil, error: null };
    });
  },

  remove: (id) => {
    set((s) => {
      const snoozedUntil = { ...s.snoozedUntil };
      delete snoozedUntil[id];
      return {
        queue: pruneExecApprovalQueue(s.queue).filter((e) => e.id !== id),
        snoozedUntil,
        error: null,
      };
    });
  },

  defer: (id) => {
    const entry = get().queue.find((e) => e.id === id);
    if (!entry) return false;
    const until = computeApprovalSnoozeUntil(Date.now(), entry.expiresAtMs);
    if (until == null) {
      set({ error: "此项即将过期，请立即允许或拒绝。" });
      return false;
    }
    set((s) => ({
      snoozedUntil: { ...s.snoozedUntil, [id]: until },
      error: null,
    }));
    return true;
  },

  clearExpiredSnoozes: () => {
    const now = Date.now();
    set((s) => {
      const next: Record<string, number> = {};
      for (const [id, until] of Object.entries(s.snoozedUntil)) {
        if (until > now) next[id] = until;
      }
      return Object.keys(next).length === Object.keys(s.snoozedUntil).length
        ? s
        : { snoozedUntil: next };
    });
  },

  selectActive: () => {
    get().clearExpiredSnoozes();
    const now = Date.now();
    const queue = pruneExecApprovalQueue(get().queue);
    return queue.find((e) => (get().snoozedUntil[e.id] ?? 0) <= now) ?? null;
  },

  refresh: async () => {
    const client = getGatewayClient();
    if (!client.isHelloOk) return;
    try {
      const refreshed = await fetchPendingApprovals((m, p) => client.request(m, p));
      set({ queue: refreshed, error: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ error: msg.slice(0, 160) });
    }
  },

  resolve: async (id, decision) => {
    const entry = get().queue.find((e) => e.id === id);
    if (!entry) return;
    const client = getGatewayClient();
    if (!client.isHelloOk) return;
    set({ busy: true, error: null });
    try {
      await resolveExecApproval((m, p) => client.request(m, p), id, decision, entry.kind);
      get().remove(id);
      await get().refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unknown or expired approval/i.test(msg)) {
        get().remove(id);
      } else {
        set({ error: msg.slice(0, 160) });
      }
    } finally {
      set({ busy: false });
    }
  },

  handleGatewayEvent: (event, payload) => {
    const el = event.toLowerCase();
    if (el === "exec.approval.requested") {
      const parsed = parseExecApprovalRequested(payload);
      if (parsed) get().enqueue(parsed);
      return;
    }
    if (el === "plugin.approval.requested") {
      const parsed = parsePluginApprovalRequested(payload);
      if (parsed) get().enqueue(parsed);
      return;
    }
    if (el === "exec.approval.resolved" || el === "plugin.approval.resolved") {
      const id =
        payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).id === "string"
          ? ((payload as Record<string, unknown>).id as string)
          : null;
      if (id) get().remove(id);
    }
  },
}));
