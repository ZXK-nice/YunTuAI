import type { CatalogModel } from "../../types/model";
import { formatContextLabel } from "./context-label";

/** 小米 MiMo（OpenAI 兼容：https://api.xiaomimimo.com/v1）。id 必须是接口模型 ID。 */
export const MIMO_MODEL_CATALOG: CatalogModel[] = [
  {
    id: "mimo-v2.6-pro",
    label: "MiMo V2.6 Pro",
    provider: "mimo",
    capabilities: ["reasoning", "tools", "vision"],
    contextTokens: 1_048_576,
    contextLabel: formatContextLabel(1_048_576),
    tooltip: {
      strengths: "复杂任务、长文档与工具调用。接口模型 ID 为 mimo-v2.6-pro。",
      inputPricePerMillionCny: 3,
      outputPricePerMillionCny: 6,
      supportsImage: true,
      supportsVideo: false,
      priceNote: "以小米 MiMo 开放平台为准",
    },
  },
  {
    id: "mimo-v2.6-flash",
    label: "MiMo V2.6 Flash",
    provider: "mimo",
    capabilities: ["reasoning", "tools", "vision"],
    contextTokens: 1_048_576,
    contextLabel: formatContextLabel(1_048_576),
    tooltip: {
      strengths: "日常办公与大批量调用。接口模型 ID 为 mimo-v2.6-flash。",
      inputPricePerMillionCny: 1,
      outputPricePerMillionCny: 2,
      supportsImage: true,
      supportsVideo: false,
      priceNote: "以小米 MiMo 开放平台为准",
    },
  },
  {
    id: "mimo-v2.5",
    label: "MiMo V2.5",
    provider: "mimo",
    capabilities: ["reasoning", "tools", "vision"],
    contextTokens: 1_048_576,
    contextLabel: formatContextLabel(1_048_576),
    tooltip: {
      strengths: "全模态理解（图/音/视频）+ 工具调用；办公场景可直连识图，长上下文。",
      inputPricePerMillionCny: 1,
      outputPricePerMillionCny: 2,
      supportsImage: true,
      supportsVideo: true,
      priceNote: "未命中缓存输入价；命中缓存输入约 ¥0.02/百万",
    },
  },
  {
    id: "mimo-v2.5-pro",
    label: "MiMo V2.5 Pro",
    provider: "mimo",
    capabilities: ["reasoning", "tools"],
    contextTokens: 1_048_576,
    contextLabel: formatContextLabel(1_048_576),
    tooltip: {
      strengths: "复杂推理、深度分析与长文档；纯文本对话与工具调用，图片附件走内置 OCR。",
      inputPricePerMillionCny: 3,
      outputPricePerMillionCny: 6,
      supportsImage: false,
      supportsVideo: false,
      priceNote: "未命中缓存输入价；命中缓存输入约 ¥0.025/百万",
    },
  },
];
