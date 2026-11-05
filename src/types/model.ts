/** 模型厂商（中转站分组 + 自用版直连/自定义） */
export type ModelProvider =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "qwen"
  | "mimo"
  | "zhipu"
  | "moonshot"
  | "ark"
  | "siliconflow"
  | "minimax"
  | "spark"
  | "hunyuan"
  | "custom";

/** 模型悬停说明：长处、价格与多模态能力 */
export type ModelCatalogTooltip = {
  /** 一两句话概括适用场景与长处 */
  strengths: string;
  /** 输入价格（元 / 百万 tokens，256K 档参考价） */
  inputPricePerMillionCny: number;
  /** 输出价格（元 / 百万 tokens） */
  outputPricePerMillionCny: number;
  /** 是否支持图片理解（多模态） */
  supportsImage: boolean;
  /** 是否支持视频理解 */
  supportsVideo: boolean;
  /** 价格备注（如阶梯计价） */
  priceNote?: string;
};

export type ModelCapability =
  | "reasoning"
  | "tools"
  | "files"
  | "open-weights"
  | "vision"
  | "image-gen"
  | "video-gen";

/** 目录中的可选模型 */
export type CatalogModel = {
  id: string;
  label: string;
  provider: ModelProvider;
  capabilities?: ModelCapability[];
  /** 展示用，如 128K（优先于 contextTokens 手填） */
  contextLabel?: string;
  /** 上下文 token 上限（与 openclaw.json contextWindow 对齐） */
  contextTokens?: number;
  /** 悬停卡片：长处、价格、多模态 */
  tooltip?: ModelCatalogTooltip;
};

export type ModelProviderGroup = {
  provider: ModelProvider;
  label: string;
  models: CatalogModel[];
};

/** `auto` = 智能路由；其余为具体模型短 id */
export type ModelSelectionId = "auto" | string;

export const AUTO_MODEL_ID = "auto" as const;
export const DEFAULT_MODEL_ID = "deepseek-flash";

export type ModelSwitchResult = {
  ok: boolean;
  selectionId: ModelSelectionId;
  /** 实际将用于请求的模型短 id */
  resolvedModelId: string;
  /** 是否已写入本机服务配置（仅部分发行档/模型支持） */
  backendSynced: boolean;
  message?: string;
};
