import type { CatalogModel } from "../../types/model";
import { formatContextLabel } from "./context-label";

/** 千问 3.6 / 3.7 系列（DashScope OpenAI 兼容）；上下文见百炼官方文档。 */
export const QWEN_MODEL_CATALOG: CatalogModel[] = [
  {
    id: "qwen3.6-flash",
    label: "Qwen3.6 Flash",
    provider: "qwen",
    capabilities: ["reasoning", "tools", "vision"],
    contextTokens: 1_000_000,
    contextLabel: formatContextLabel(1_000_000),
    tooltip: {
      strengths: "极速低成本，原生多模态；Agent/Coding 与空间定位能力强，适合日常对话与图文混排。",
      inputPricePerMillionCny: 1.2,
      outputPricePerMillionCny: 7.2,
      supportsImage: true,
      supportsVideo: true,
      priceNote: "超 256K 输入/输出按阶梯计价",
    },
  },
  {
    id: "qwen3.6-plus",
    label: "Qwen3.6 Plus",
    provider: "qwen",
    capabilities: ["reasoning", "tools", "files", "vision"],
    contextTokens: 1_000_000,
    contextLabel: formatContextLabel(1_000_000),
    tooltip: {
      strengths: "均衡旗舰：复杂推理、工具调用与长文档；多模态理解优于 Flash，适合办公分析。",
      inputPricePerMillionCny: 2,
      outputPricePerMillionCny: 12,
      supportsImage: true,
      supportsVideo: false,
      priceNote: "超 256K 输入/输出按阶梯计价",
    },
  },
  {
    id: "qwen3.7-plus",
    label: "Qwen3.7 Plus",
    provider: "qwen",
    capabilities: ["reasoning", "tools", "files", "vision"],
    contextTokens: 1_000_000,
    contextLabel: formatContextLabel(1_000_000),
    tooltip: {
      strengths: "新一代 Plus：更强 Agent 与代码能力，复杂任务与长上下文表现更好。",
      inputPricePerMillionCny: 2.5,
      outputPricePerMillionCny: 12,
      supportsImage: true,
      supportsVideo: false,
      priceNote: "价格以百炼控制台为准",
    },
  },
  {
    id: "qwen3.7-max",
    label: "Qwen3.7 Max",
    provider: "qwen",
    capabilities: ["reasoning", "tools", "files", "vision"],
    contextTokens: 1_000_000,
    contextLabel: formatContextLabel(1_000_000),
    tooltip: {
      strengths: "最强千问档：深度推理、复杂 Agent 与多模态旗舰，适合高难度分析与创作。",
      inputPricePerMillionCny: 2.5,
      outputPricePerMillionCny: 10,
      supportsImage: true,
      supportsVideo: true,
      priceNote: "价格以百炼控制台为准",
    },
  },
];
