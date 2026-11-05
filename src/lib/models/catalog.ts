import type { CatalogModel, ModelProvider, ModelProviderGroup } from "../../types/model";
import { AUTO_MODEL_ID } from "../../types/model";
import { getRuntimeDefaultModelId } from "./runtime-default-model";
import { QWEN_MODEL_CATALOG } from "./qwen-catalog";
import { MIMO_MODEL_CATALOG } from "./mimo-catalog";
import { DEEPSEEK_COMPAT_ALIASES, DEEPSEEK_MODEL_CATALOG } from "./deepseek-catalog";
import { formatContextLabel } from "./context-label";

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  qwen: "千问 Qwen",
  mimo: "小米 MiMo",
  zhipu: "智谱 GLM",
  moonshot: "月之暗面 Kimi",
  ark: "火山方舟",
  siliconflow: "硅基流动",
  minimax: "MiniMax",
  spark: "讯飞星火",
  hunyuan: "腾讯混元",
  custom: "自定义",
};

/** 内部版模型目录：DeepSeek（默认）+ MiMo + 千问 */
export const INTERNAL_MODEL_CATALOG: CatalogModel[] = [
  ...DEEPSEEK_MODEL_CATALOG,
  ...MIMO_MODEL_CATALOG,
  ...QWEN_MODEL_CATALOG,
];

/** 云图中转站上架模型（2026-09-29，对照 api.doohuan.com/api/pricing）。不能自行追加。 */
type RelaySpec = {
  id: string;
  label: string;
  provider: ModelProvider;
  ctx: number;
  caps: NonNullable<CatalogModel["capabilities"]>;
};

const RELAY_SPECS: RelaySpec[] = [
  { id: "gpt-5.5", label: "GPT 5.5", provider: "openai", ctx: 1_153_434, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "gpt-5.5-pro", label: "GPT 5.5 Pro", provider: "openai", ctx: 1_153_434, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "gpt-5.4", label: "GPT 5.4", provider: "openai", ctx: 1_153_434, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "gpt-5.4-mini", label: "GPT 5.4 Mini", provider: "openai", ctx: 409_600, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-opus-4-5-20251101", label: "Claude Opus 4.5", provider: "anthropic", ctx: 204_800, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic", ctx: 204_800, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic", ctx: 204_800, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: "anthropic", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", ctx: 1_048_576, caps: ["reasoning", "tools"] },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: "deepseek", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "deepseek-v3.1", label: "DeepSeek V3.1", provider: "deepseek", ctx: 131_072, caps: ["reasoning", "tools"] },
  { id: "qwen3.5-plus", label: "Qwen3.5 Plus", provider: "qwen", ctx: 1_048_576, caps: ["reasoning", "tools", "vision"] },
  { id: "qwen3.5-flash", label: "Qwen3.5 Flash", provider: "qwen", ctx: 1_048_576, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "glm-5.2", label: "GLM 5.2", provider: "zhipu", ctx: 1_048_576, caps: ["reasoning", "tools"] },
  { id: "glm-5.1", label: "GLM 5.1", provider: "zhipu", ctx: 204_800, caps: ["reasoning", "tools"] },
  { id: "glm-5", label: "GLM 5", provider: "zhipu", ctx: 209_715, caps: ["reasoning", "tools"] },
  { id: "glm-5-turbo", label: "GLM 5 Turbo", provider: "zhipu", ctx: 204_800, caps: ["reasoning", "tools"] },
  { id: "glm-5v-turbo", label: "GLM 5V Turbo", provider: "zhipu", ctx: 204_800, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "kimi-k2.6", label: "Kimi K2.6", provider: "moonshot", ctx: 268_390, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "kimi-k2.5", label: "Kimi K2.5", provider: "moonshot", ctx: 268_390, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", provider: "moonshot", ctx: 268_390, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", provider: "moonshot", ctx: 268_390, caps: ["reasoning", "tools", "files", "vision"] },
  { id: "minimax-m3", label: "MiniMax M3", provider: "minimax", ctx: 1_048_576, caps: ["reasoning", "tools", "vision"] },
  { id: "minimax-m2.7", label: "MiniMax M2.7", provider: "minimax", ctx: 209_715, caps: ["reasoning", "tools"] },
  { id: "minimax-m2.5", label: "MiniMax M2.5", provider: "minimax", ctx: 209_715, caps: ["reasoning", "tools"] },
  { id: "hy3-preview", label: "腾讯 Hy3 Preview", provider: "hunyuan", ctx: 262_144, caps: ["reasoning", "tools"] },
];

export const RELAY_MODEL_CATALOG: CatalogModel[] = RELAY_SPECS.map((m) => ({
  id: m.id,
  label: m.label,
  provider: m.provider,
  capabilities: m.caps,
  contextTokens: m.ctx,
  contextLabel: formatContextLabel(m.ctx),
  tooltip: {
    strengths: "通过云图中转站调用，不能改成自有接口。",
    inputPricePerMillionCny: 0,
    outputPricePerMillionCny: 0,
    supportsImage: m.caps.includes("vision"),
    supportsVideo: false,
    priceNote: "以中转站定价为准",
  },
}));

export function catalogForProfile(profileId?: string | null): CatalogModel[] {
  return profileId === "relay-station" ? RELAY_MODEL_CATALOG : INTERNAL_MODEL_CATALOG;
}

function mergeCatalogModels(a: CatalogModel, b: CatalogModel): CatalogModel {
  return {
    ...a,
    ...b,
    tooltip: b.tooltip ?? a.tooltip,
    contextTokens: b.contextTokens ?? a.contextTokens,
    contextLabel: b.contextLabel ?? a.contextLabel,
    capabilities: b.capabilities?.length ? b.capabilities : a.capabilities,
  };
}

const catalogById = new Map<string, CatalogModel>();
let userCatalogModels: CatalogModel[] = [];

for (const m of [...RELAY_MODEL_CATALOG, ...INTERNAL_MODEL_CATALOG, ...DEEPSEEK_COMPAT_ALIASES]) {
  const prev = catalogById.get(m.id);
  catalogById.set(m.id, prev ? mergeCatalogModels(prev, m) : m);
}

export function setUserCatalogModels(models: CatalogModel[]): void {
  userCatalogModels = models.filter((m) => m.id.trim().length > 0);
}

function foldModelKey(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

export function getCatalogModel(modelId: string): CatalogModel | undefined {
  const raw = modelId.trim();
  const userFull = userCatalogModels.find(
    (m) => m.id === raw || `${m.provider}/${m.id}` === raw,
  );
  if (userFull) return userFull;
  const short = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const direct = catalogById.get(short) ?? userCatalogModels.find((m) => m.id === short);
  if (direct) return direct;
  const folded = foldModelKey(short);
  return catalogById.get(folded) ?? userCatalogModels.find((m) => m.id === folded);
}

export function listModelProviderGroups(profileId?: string | null): ModelProviderGroup[] {
  const catalog = [...catalogForProfile(profileId), ...userCatalogModels];
  const buckets = new Map<ModelProvider, CatalogModel[]>();
  for (const m of catalog) {
    const list = buckets.get(m.provider) ?? [];
    if (!list.some((x) => x.id === m.id)) list.push(m);
    buckets.set(m.provider, list);
  }
  const order: ModelProvider[] = [
    "openai",
    "anthropic",
    "deepseek",
    "qwen",
    "mimo",
    "zhipu",
    "moonshot",
    "ark",
    "siliconflow",
    "minimax",
    "spark",
    "hunyuan",
    "custom",
  ];
  return order
    .filter((p) => buckets.has(p))
    .map((provider) => ({
      provider,
      label: PROVIDER_LABELS[provider],
      models: buckets.get(provider)!,
    }));
}

export type ModelMenuEntry =
  | { kind: "auto"; id: typeof AUTO_MODEL_ID; label: string; hint: string }
  | { kind: "model"; model: CatalogModel };

/** 下拉菜单扁平列表（Auto + 分组模型） */
export function buildModelMenuEntries(profileId?: string | null): ModelMenuEntry[] {
  const entries: ModelMenuEntry[] = [
    {
      kind: "auto",
      id: AUTO_MODEL_ID,
      label: "Auto",
      hint: `智能选择 · 当前默认 ${getCatalogModel(getRuntimeDefaultModelId())?.label ?? getRuntimeDefaultModelId()}`,
    },
  ];
  for (const group of listModelProviderGroups(profileId)) {
    for (const model of group.models) {
      entries.push({ kind: "model", model });
    }
  }
  return entries;
}

export function resolveSelectionToModelId(selectionId: string): string {
  const fallback = getRuntimeDefaultModelId();
  if (selectionId === AUTO_MODEL_ID) return fallback;
  const trimmed = selectionId.trim();
  if (!trimmed) return fallback;
  return getCatalogModel(trimmed)?.id ?? trimmed;
}

export function modelUsesDirectVision(modelId: string): boolean {
  const short = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  const m = getCatalogModel(short);
  if (!m) return false;
  if (m.tooltip?.supportsImage) return true;
  return Boolean(m.capabilities?.includes("vision"));
}

export function displayLabelForSelection(selectionId: string): string {
  if (selectionId === AUTO_MODEL_ID) return "Auto";
  return getCatalogModel(selectionId)?.label ?? selectionId;
}

/** 弹层打开时定位到当前模型所属厂商；Auto 或未知则优先 DeepSeek。 */
export function resolveVendorForSelection(
  selectionId: string,
  groups: ModelProviderGroup[],
): ModelProvider | null {
  if (groups.length === 0) return null;
  const resolved =
    selectionId === AUTO_MODEL_ID ? getRuntimeDefaultModelId() : selectionId.trim();
  const fromModel = getCatalogModel(resolved)?.provider;
  if (fromModel && groups.some((g) => g.provider === fromModel)) return fromModel;
  const deepseek = groups.find((g) => g.provider === "deepseek");
  return deepseek?.provider ?? groups[0]!.provider;
}
