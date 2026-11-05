import { invokeAuthed } from "../tauri-invoke";
import type { CatalogModel, ModelProvider } from "../../types/model";

export type LlmPreset = {
  id: string;
  label: string;
  envKey: string;
  defaultBaseUrl: string;
  exampleModel: string;
  allowsCustomBaseUrl: boolean;
};

export type UserLlmSlot = {
  id: string;
  label: string;
  envKey: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  configured: boolean;
  allowsCustomBaseUrl: boolean;
};

const USER_PROVIDER_IDS = new Set<ModelProvider>([
  "zhipu",
  "moonshot",
  "ark",
  "siliconflow",
  "minimax",
  "spark",
  "custom",
]);

export function isUserLlmProvider(id: string): id is ModelProvider {
  return USER_PROVIDER_IDS.has(id as ModelProvider);
}

export function slotToCatalogModel(slot: UserLlmSlot): CatalogModel | null {
  const id = slot.modelId.trim();
  if (!id || !slot.configured) return null;
  const provider = (USER_PROVIDER_IDS.has(slot.id as ModelProvider)
    ? slot.id
    : "custom") as ModelProvider;
  return {
    id,
    label: slot.modelName.trim() || `${slot.label} · ${id}`,
    provider,
    capabilities: ["tools"],
  };
}

export async function fetchLlmPresets(): Promise<LlmPreset[]> {
  return (await invokeAuthed<LlmPreset[]>("llm_user_list_presets")) ?? [];
}

export async function fetchLlmSlots(): Promise<UserLlmSlot[]> {
  return (await invokeAuthed<UserLlmSlot[]>("llm_user_list_slots")) ?? [];
}

export async function saveLlmSlot(input: {
  id: string;
  apiKey: string;
  modelId: string;
  modelName?: string;
  baseUrl?: string;
}): Promise<UserLlmSlot[]> {
  const slots = await invokeAuthed<UserLlmSlot[]>("llm_user_save_slot", {
    id: input.id,
    apiKey: input.apiKey,
    modelId: input.modelId,
    modelName: input.modelName ?? "",
    baseUrl: input.baseUrl ?? "",
  });
  if (!slots) throw new Error("保存模型接入失败");
  return slots;
}

export async function clearLlmSlot(id: string): Promise<UserLlmSlot[]> {
  const slots = await invokeAuthed<UserLlmSlot[]>("llm_user_clear_slot", { id });
  if (!slots) throw new Error("清除模型接入失败");
  return slots;
}
