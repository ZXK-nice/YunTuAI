import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "../agentStore";
import { useStepStore } from "../stepStore";

describe("agentStore.evictAgent", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        {
          id: "main",
          name: "默认",
          model: "deepseek/deepseek-v4-flash",
          provider: "deepseek",
          isDefault: true,
          skills: [],
          workspace: "",
          sandboxMode: "off",
        },
        {
          id: "kb-assistant",
          name: "知识库助手",
          model: "deepseek/deepseek-v4-flash",
          provider: "deepseek",
          isDefault: false,
          skills: ["kret-rag-kb"],
          workspace: "",
          sandboxMode: "off",
        },
      ],
      activeAgentId: "kb-assistant",
      loading: false,
      lastLoadedAt: null,
    });
    useStepStore.getState().setActiveAgent("kb-assistant", "知识库助手");
  });

  it("removes agent and switches to default when evicting active agent", () => {
    useAgentStore.getState().evictAgent("kb-assistant");
    const st = useAgentStore.getState();
    expect(st.agents.some((a) => a.id === "kb-assistant")).toBe(false);
    expect(st.activeAgentId).toBe("main");
    expect(useStepStore.getState().activeAgentName).toBe("默认");
  });

  it("no-op when agent id not in list", () => {
    useAgentStore.getState().evictAgent("missing");
    expect(useAgentStore.getState().agents).toHaveLength(2);
  });
});

describe("agentStore.loadAgents force", () => {
  beforeEach(() => {
    useAgentStore.setState({ loading: true, agents: [], activeAgentId: null, lastLoadedAt: null });
  });

  it("skips when loading unless force", async () => {
    await useAgentStore.getState().loadAgents();
    expect(useAgentStore.getState().loading).toBe(true);
  });
});
