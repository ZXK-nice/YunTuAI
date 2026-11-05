import type { CatalogModel } from "../../types/model";
import { formatContextLabel } from "./context-label";

const FLASH_CONTEXT = 1_048_576;

/** DeepSeek V4.1 Flash：官网模型名 `deepseek-flash`，原生多模态识图。 */
export const DEEPSEEK_FLASH_MODEL: CatalogModel = {
  id: "deepseek-flash",
  label: "DeepSeek V4.1 Flash",
  provider: "deepseek",
  capabilities: ["reasoning", "tools", "vision"],
  contextTokens: FLASH_CONTEXT,
  contextLabel: formatContextLabel(FLASH_CONTEXT),
  tooltip: {
    strengths: "最新极速多模态：原生识图、百万上下文与工具调用；图片直传，不走本地 OCR。",
    inputPricePerMillionCny: 1,
    outputPricePerMillionCny: 2,
    supportsImage: true,
    supportsVideo: false,
    priceNote: "以 DeepSeek 官网为准",
  },
};

/** 已退役 id，官方仍转发到 V4.1 Flash；仅用于旧会话解析，不出现在选择器。 */
export const DEEPSEEK_COMPAT_ALIASES: CatalogModel[] = [
  {
    ...DEEPSEEK_FLASH_MODEL,
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
  },
  {
    ...DEEPSEEK_FLASH_MODEL,
    id: "deepseek-v4-flash-vision-exp",
    label: "DeepSeek V4 Flash Vision",
  },
];

/** 内部版 DeepSeek 可选模型（选择器展示）。 */
export const DEEPSEEK_MODEL_CATALOG: CatalogModel[] = [
  DEEPSEEK_FLASH_MODEL,
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    capabilities: ["reasoning", "tools", "vision"],
    contextTokens: FLASH_CONTEXT,
    contextLabel: formatContextLabel(FLASH_CONTEXT),
    tooltip: {
      strengths:
        "过渡期由 V4.1 Flash 承接（含原生识图），直至 V4.1 Pro 上线；图片直传，不走本地 OCR。",
      inputPricePerMillionCny: 1,
      outputPricePerMillionCny: 2,
      supportsImage: true,
      supportsVideo: false,
      priceNote: "以 DeepSeek 官网为准；当前按 V4.1 Flash 计费",
    },
  },
];
