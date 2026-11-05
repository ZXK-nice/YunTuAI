import { invoke } from "@tauri-apps/api/core";
import { invokeWithAuthRetry } from "../auth-token";
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import relayModels from "../../../scripts/relay-models.json";

export type EnvKeyRequirement = {
  id: string;
  label: string;
  hint: string;
  configured: boolean;
  required: boolean;
  editable?: boolean;
};

export type OpenClawEnvStatus = {
  bundledManaged: boolean;
  setupRequired: boolean;
  apiKeyLocked?: boolean;
  keys: EnvKeyRequirement[];
  envPath: string;
};

export type DistributionProfileInfo = {
  profile: string;
  profileLabel: string;
  apiKeyLocked: boolean;
  openRegistration: boolean;
  defaultModelId: string;
  devAgnesEnabled?: boolean;
};

export type ModelOption = {
  id: string;
  label: string;
};

/** 内部版默认模型列表（浏览器预览 / IPC 失败时回退） */
const DEEPSEEK_MODELS: ModelOption[] = [
  { id: "deepseek-flash", label: "DeepSeek V4.1 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "mimo-v2.6-pro", label: "MiMo V2.6 Pro" },
  { id: "mimo-v2.6-flash", label: "MiMo V2.6 Flash" },
  { id: "mimo-v2.5", label: "MiMo V2.5" },
  { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
  { id: "qwen3.6-flash", label: "Qwen3.6 Flash" },
  { id: "qwen3.6-plus", label: "Qwen3.6 Plus" },
  { id: "qwen3.7-plus", label: "Qwen3.7 Plus" },
  { id: "qwen3.7-max", label: "Qwen3.7 Max" },
];

const RELAY_MODELS: ModelOption[] = relayModels.models.map((m) => ({
  id: m.id,
  label: m.name,
}));

export async function fetchDistributionProfile(): Promise<DistributionProfileInfo | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke<DistributionProfileInfo>("openclaw_distribution_profile_cmd");
  } catch {
    return null;
  }
}

export async function fetchOpenClawEnvStatus(): Promise<OpenClawEnvStatus | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invokeWithAuthRetry<OpenClawEnvStatus>("openclaw_env_status_cmd", {}, {
      timeoutMs: 5_000,
      critical: false,
    });
  } catch {
    return null;
  }
}

export async function saveOpenClawEnvKeys(keys: Record<string, string>): Promise<OpenClawEnvStatus | null> {
  return invokeAuthed<OpenClawEnvStatus>("openclaw_env_save_keys_cmd", { keys });
}


export async function fetchAvailableModels(): Promise<ModelOption[]> {
  const list = await invokeAuthed<ModelOption[]>("openclaw_env_list_models");
  if (list?.length) {
    return list.filter((m) => !m.id.startsWith("agnes-"));
  }
  const profile = await fetchDistributionProfile();
  if (profile?.profile === "relay-station") {
    return RELAY_MODELS;
  }
  return DEEPSEEK_MODELS;
}

export async function fetchCurrentModel(): Promise<string | null> {
  return invokeAuthed<string>("openclaw_env_get_model");
}

export async function setModel(modelId: string): Promise<void> {
  await invokeAuthed<void>("openclaw_env_set_model", { modelId });
}
