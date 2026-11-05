import { create } from "zustand";
import { getGatewayClient } from "../lib/openclaw/gateway-runtime";
import { fetchAgentList, type AgentInfo } from "../lib/openclaw/agent-rpc";
import { useStepStore } from "./stepStore";

type AgentStore = {
  agents: AgentInfo[];
  activeAgentId: string | null;
  loading: boolean;
  lastLoadedAt: number | null;

  loadAgents: (opts?: { force?: boolean }) => Promise<void>;
  selectAgent: (id: string) => void;
  clearAgents: () => void;
  /** 从本地列表移除 Agent（网关热下线后的 UI 同步） */
  evictAgent: (id: string) => void;
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  activeAgentId: null,
  loading: false,
  lastLoadedAt: null,

  loadAgents: async (opts) => {
    if (get().loading && !opts?.force) return;
    set({ loading: true });
    try {
      const client = getGatewayClient();
      if (!client.isHelloOk) return;
      const result = await fetchAgentList((m, p) => client.request(m, p));
      const agents = result.agents;
      const defaultAgent = agents.find((a) => a.isDefault) ?? agents[0];
      const nextAgentId = get().activeAgentId && agents.some((a) => a.id === get().activeAgentId)
        ? get().activeAgentId
        : defaultAgent?.id ?? agents[0]?.id ?? null;
      const nextAgent = agents.find((a) => a.id === nextAgentId);
      set({
        agents,
        activeAgentId: nextAgentId,
        lastLoadedAt: Date.now(),
      });
      useStepStore.getState().setActiveAgent(nextAgentId, nextAgent?.name ?? null);
    } catch (err) {
      // 网关可能尚未就绪或未实现 agents.list：UI 保持静默（避免连接抖动期噪音），
      // 但记录到控制台以便诊断「Agent 列表为空」的原因。
      console.warn("[agentStore] loadAgents failed:", err);
    } finally {
      set({ loading: false });
    }
  },

  selectAgent: (id) => {
    if (!get().agents.some((a) => a.id === id)) return;
    const prev = get().activeAgentId;
    if (prev === id) return;
    const agent = get().agents.find((a) => a.id === id);
    set({ activeAgentId: id });
    useStepStore.getState().setActiveAgent(id, agent?.name ?? null);
    void import("./sessionStore").then(({ useSessionStore }) => {
      void useSessionStore.getState().createSession(id);
    });
  },

  clearAgents: () => {
    set({ agents: [], activeAgentId: null, lastLoadedAt: null });
    useStepStore.getState().setActiveAgent(null, null);
  },

  evictAgent: (id) => {
    const { agents, activeAgentId } = get();
    const next = agents.filter((a) => a.id !== id);
    if (next.length === agents.length) return;
    let nextActive = activeAgentId;
    if (activeAgentId === id) {
      nextActive = next.find((a) => a.isDefault)?.id ?? next[0]?.id ?? null;
    }
    const agent = next.find((a) => a.id === nextActive);
    set({ agents: next, activeAgentId: nextActive });
    useStepStore.getState().setActiveAgent(nextActive, agent?.name ?? null);
  },
}));
