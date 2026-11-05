import { invokeWithAuthRetry } from "../auth-token";
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

export type KbAssistantStatus = {
  enabled: boolean;
  baseUrl: string;
  skillInstalled: boolean;
  agentPresent: boolean;
  healthOk?: boolean | null;
  healthMessage?: string | null;
};

// 默认指向本机，部署时由设置项覆盖（示例仓库中不内置任何内网地址）
export const KB_ASSISTANT_DEFAULT_BASE_URL = "http://127.0.0.1:8000";
export const KB_ASSISTANT_AGENT_ID = "kb-assistant";
export const KB_ASSISTANT_SKILL_ID = "kret-rag-kb";

export async function fetchKbAssistantStatus(
  probeHealth = false,
): Promise<KbAssistantStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<KbAssistantStatus>("kb_assistant_status_cmd", {
    probeHealth,
  });
}

export async function enableKbAssistant(baseUrl: string): Promise<KbAssistantStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeWithAuthRetry<KbAssistantStatus>(
    "kb_assistant_enable_cmd",
    { baseUrl },
    { timeoutMs: 15_000, critical: false },
  );
}

export async function disableKbAssistant(): Promise<KbAssistantStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeWithAuthRetry<KbAssistantStatus>(
    "kb_assistant_disable_cmd",
    {},
    { timeoutMs: 12_000, critical: false },
  );
}

export async function saveKbAssistantConfig(baseUrl: string): Promise<KbAssistantStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<KbAssistantStatus>("kb_assistant_save_config_cmd", { baseUrl });
}

export async function probeKbAssistantHealth(baseUrl: string): Promise<KbAssistantStatus | null> {
  if (!isTauriRuntime()) return null;
  return invokeWithAuthRetry<KbAssistantStatus>(
    "kb_assistant_probe_health_cmd",
    { baseUrl },
    { timeoutMs: 5_000, critical: false },
  );
}

/** 写入 openclaw.json 后热刷网关，使 Agent / 技能列表立即生效。 */
export async function hotReloadKbAssistantAfterToggle(enabled: boolean): Promise<void> {
  const { getGatewayClient } = await import("../openclaw/gateway-runtime");
  const { deleteAgent } = await import("../openclaw/agent-rpc");
  const { quickHotReloadGatewaySkills } = await import("../skills/skill-hot-reload");
  const { useGatewayStore } = await import("../../stores/gatewayStore");
  const { useAgentStore } = await import("../../stores/agentStore");

  const client = getGatewayClient();
  const connected = client.isHelloOk && useGatewayStore.getState().connState === "connected";

  if (connected) {
    const request = (method: string, params: Record<string, unknown>) =>
      client.request(method, params, { timeoutMs: 12_000 });

    const tasks: Promise<unknown>[] = [
      client.request("config.apply", {}, { timeoutMs: 8_000 }).catch(() => undefined),
      quickHotReloadGatewaySkills().catch(() => undefined),
    ];
    if (!enabled) {
      tasks.push(deleteAgent(request, KB_ASSISTANT_AGENT_ID).catch(() => undefined));
    }
    await Promise.all(tasks);
  }

  if (!enabled) {
    useAgentStore.getState().evictAgent(KB_ASSISTANT_AGENT_ID);
  }

  await useAgentStore.getState().loadAgents({ force: true });

  if (!enabled) {
    useAgentStore.getState().evictAgent(KB_ASSISTANT_AGENT_ID);
  }
}
