import type { EnvKeyRequirement } from "./env-bridge";

/** 内部版发行档模型厂商 API Key 分组说明 */
export const MIMO_API_KEY_ID = "MIMO_API_KEY";
export const DEEPSEEK_API_KEY_ID = "DEEPSEEK_API_KEY";
export const DASHSCOPE_API_KEY_ID = "DASHSCOPE_API_KEY";

export const MODEL_PROVIDER_KEY_IDS = [
  MIMO_API_KEY_ID,
  DEEPSEEK_API_KEY_ID,
  DASHSCOPE_API_KEY_ID,
] as const;

/** @deprecated 使用 MODEL_PROVIDER_KEY_IDS；保留别名避免大范围重命名 */
export const REQUIRED_MODEL_PROVIDER_KEY_ID = MIMO_API_KEY_ID;

export const OPTIONAL_MODEL_PROVIDER_KEY_IDS = [
  DEEPSEEK_API_KEY_ID,
  DASHSCOPE_API_KEY_ID,
] as const;

export type ModelProviderKeyGroup = {
  id: string;
  providerLabel: string;
  modelHint: string;
  required: boolean;
};

/** 设置 / 首启引导：三类模型 API Key 分组说明 */
export const DIRECT_MODEL_PROVIDER_KEY_GROUPS: ModelProviderKeyGroup[] = [
  {
    id: DEEPSEEK_API_KEY_ID,
    providerLabel: "DeepSeek",
    modelHint: "V4.1 Flash（默认，原生识图）/ V4 Pro",
    required: false,
  },
  {
    id: MIMO_API_KEY_ID,
    providerLabel: "小米 MiMo",
    modelHint: "MiMo V2.5 / V2.5 Pro",
    required: false,
  },
  {
    id: DASHSCOPE_API_KEY_ID,
    providerLabel: "千问 Qwen",
    modelHint: "Qwen3.6 / Qwen3.7 多模态模型",
    required: false,
  },
];

export const MODEL_PROVIDER_KEY_SETUP_HINT =
  "请至少填写一家模型厂商 API Key（MiMo / DeepSeek / 千问，或下方更多国内厂商）。";

export const MODEL_PROVIDER_KEY_SETUP_DESCRIPTION =
  "至少配置一家模型厂商即可开始使用。内置 MiMo / DeepSeek / 千问，也可在设置里接入智谱、Kimi、火山方舟等国内厂商，或填写 OpenAI 兼容地址。";

export function isApiKeyConfigured(
  id: string,
  keys: EnvKeyRequirement[],
  values: Record<string, string>,
): boolean {
  if (values[id]?.trim()) return true;
  return keys.some((k) => k.id === id && k.configured);
}

/** 内部版是否已满足「至少一家」模型 Key（首启门闸 / 保存校验）。 */
export function hasRequiredModelProviderKey(
  keys: EnvKeyRequirement[],
  values: Record<string, string>,
): boolean {
  return MODEL_PROVIDER_KEY_IDS.some((id) => isApiKeyConfigured(id, keys, values));
}

const API_KEY_MISSING_CONNECT_RE =
  /MIMO_API_KEY|DEEPSEEK_API_KEY|DASHSCOPE_API_KEY|API Key|密钥|missing or empty/i;

/** 连接失败是否因模型厂商 API Key 未配置（用于引导到 ApiKeySetupScreen）。 */
export function isApiKeyMissingConnectError(err: string | null | undefined): boolean {
  const text = err?.trim();
  if (!text) return false;
  return API_KEY_MISSING_CONNECT_RE.test(text);
}

export function keyRequirementLabel(key: EnvKeyRequirement): string {
  if (key.required) return "（必填）";
  return "（选填，切换该厂商模型时需要）";
}

/** 首启/设置页默认折叠的选填厂商（减少首屏高度）。 */
export function isCollapsibleOptionalProviderKey(id: string): boolean {
  return id === DASHSCOPE_API_KEY_ID || id === MIMO_API_KEY_ID;
}
