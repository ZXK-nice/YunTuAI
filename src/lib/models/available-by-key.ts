import type { ModelProvider, ModelProviderGroup } from "../../types/model";
import { DEFAULT_MODEL_ID } from "../../types/model";
import {
  DASHSCOPE_API_KEY_ID,
  DEEPSEEK_API_KEY_ID,
  MIMO_API_KEY_ID,
} from "../openclaw/api-key-policy";
import type { EnvKeyRequirement } from "../openclaw/env-bridge";
import { isRelayProfile, RELAY_PROFILE_ID } from "../distribution-profile";
import { catalogForProfile, getCatalogModel } from "./catalog";

export const PROVIDER_API_KEY_ID: Partial<Record<ModelProvider, string>> = {
  mimo: MIMO_API_KEY_ID,
  deepseek: DEEPSEEK_API_KEY_ID,
  qwen: DASHSCOPE_API_KEY_ID,
  zhipu: "ZHIPU_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  ark: "ARK_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  minimax: "MINIMAX_API_KEY",
  spark: "SPARK_API_KEY",
  custom: "CUSTOM_LLM_API_KEY",
};

export const PROVIDER_DEFAULT_MODEL_ID: Partial<Record<ModelProvider, string>> = {
  deepseek: "deepseek-flash",
  mimo: "mimo-v2.6-pro",
  qwen: "qwen3.6-flash",
};

const DIRECT_PROVIDER_ORDER: ModelProvider[] = [
  "deepseek",
  "mimo",
  "qwen",
  "zhipu",
  "moonshot",
  "ark",
  "siliconflow",
  "minimax",
  "spark",
  "hunyuan",
  "custom",
];

export function configuredDirectProviders(keys: readonly EnvKeyRequirement[]): Set<ModelProvider> {
  const configured = new Set(
    keys.filter((k) => k.configured).map((k) => k.id),
  );
  const out = new Set<ModelProvider>();
  for (const provider of DIRECT_PROVIDER_ORDER) {
    const envId = PROVIDER_API_KEY_ID[provider];
    if (envId && configured.has(envId)) out.add(provider);
  }
  return out;
}

export function defaultModelIdForProviders(providers: Set<ModelProvider>): string {
  for (const provider of DIRECT_PROVIDER_ORDER) {
    if (!providers.has(provider)) continue;
    const id = PROVIDER_DEFAULT_MODEL_ID[provider];
    if (id && getCatalogModel(id)) return id;
  }
  return DEFAULT_MODEL_ID;
}

export function modelProviderOfId(modelId: string): ModelProvider | undefined {
  const short = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  return getCatalogModel(short)?.provider;
}

/** 内部版：已配置至少一家时只展示对应厂商；中转站或未知时不过滤。 */
export function filterProviderGroupsByKeys(
  groups: ModelProviderGroup[],
  opts: {
    profileId?: string | null;
    allowedProviders: Set<ModelProvider> | null;
  },
): ModelProviderGroup[] {
  if (isRelayProfile(opts.profileId)) return groups;
  const allowed = opts.allowedProviders;
  if (!allowed || allowed.size === 0) return groups;
  return groups.filter((group) => {
    const envId = PROVIDER_API_KEY_ID[group.provider];
    if (!envId) return true;
    return allowed.has(group.provider);
  });
}

export function availabilityFromEnv(
  keys: readonly EnvKeyRequirement[] | null | undefined,
  profileId?: string | null,
): { allowedProviders: Set<ModelProvider> | null; defaultModelId: string } {
  if (isRelayProfile(profileId) || !keys) {
    return { allowedProviders: null, defaultModelId: DEFAULT_MODEL_ID };
  }
  const allowed = configuredDirectProviders(keys);
  if (allowed.size === 0) {
    return { allowedProviders: null, defaultModelId: DEFAULT_MODEL_ID };
  }
  return {
    allowedProviders: allowed,
    defaultModelId: defaultModelIdForProviders(allowed),
  };
}

export function isModelAllowedForKeys(
  modelId: string,
  allowedProviders: Set<ModelProvider> | null,
  profileId?: string | null,
): boolean {
  if (isRelayProfile(profileId)) {
    const short = modelId.includes("/") ? modelId.slice(modelId.lastIndexOf("/") + 1) : modelId;
    return catalogForProfile(RELAY_PROFILE_ID).some((m) => m.id === short);
  }
  if (!allowedProviders || allowedProviders.size === 0) return true;
  const provider = modelProviderOfId(modelId);
  if (!provider) return true;
  const envId = PROVIDER_API_KEY_ID[provider];
  if (!envId) return true;
  return allowedProviders.has(provider);
}

/** 设置页模型下拉：内部版只保留已配置厂商；当前选中项始终保留以免空白。 */
export function filterModelOptionsByKeys<T extends { id: string }>(
  options: T[],
  opts: {
    profileId?: string | null;
    allowedProviders: Set<ModelProvider> | null;
    keepId?: string | null;
  },
): T[] {
  if (isRelayProfile(opts.profileId)) return options;
  const allowed = opts.allowedProviders;
  if (!allowed || allowed.size === 0) return options;
  const keep = opts.keepId?.trim() || "";
  const filtered = options.filter(
    (item) => item.id === keep || isModelAllowedForKeys(item.id, allowed, opts.profileId),
  );
  return filtered.length > 0 ? filtered : options;
}
