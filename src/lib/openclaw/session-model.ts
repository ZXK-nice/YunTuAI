import type { ModelSelectionId } from "../../types/model";
import { AUTO_MODEL_ID } from "../../types/model";
import { getCatalogModel, modelUsesDirectVision, RELAY_MODEL_CATALOG } from "../models/catalog";
import { isRelayProfile } from "../distribution-profile";
import { fetchDistributionProfile } from "./env-bridge";
import { isUserLlmProvider } from "./user-llm-bridge";
import { getResolvedModelId } from "../models/model-api";
import { getGatewayClient } from "./gateway-runtime";
import { pickVisionCapableModelId } from "../models/vision";

let cachedProviderId: string | null = null;

async function providerId(): Promise<string> {
  if (cachedProviderId) return cachedProviderId;
  const profile = await fetchDistributionProfile();
  cachedProviderId = profile?.profile === "relay-station" ? "yuntuai" : "deepseek";
  return cachedProviderId;
}

/** UI 短 id → OpenClaw `provider/model`。只纠正厂商通道，模型名保持用户原文。 */
export async function qualifyOpenClawModelId(shortOrFull: string): Promise<string> {
  const raw = shortOrFull.trim();
  const profile = await fetchDistributionProfile();
  if (isRelayProfile(profile?.profile)) {
    const short = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
    const hit = RELAY_MODEL_CATALOG.find((m) => m.id === short);
    const id = hit?.id || profile?.defaultModelId?.trim() || "gpt-5.5";
    const safe = RELAY_MODEL_CATALOG.some((m) => m.id === id) ? id : "gpt-5.5";
    return `yuntuai/${safe}`;
  }
  if (!raw) {
    const profile = await fetchDistributionProfile();
    const defaultId = profile?.defaultModelId?.trim();
    if (defaultId) return qualifyOpenClawModelId(defaultId);
    return `${await providerId()}/deepseek-flash`;
  }

  const userSlot = getCatalogModel(raw);
  if (
    userSlot &&
    isUserLlmProvider(userSlot.provider) &&
    (raw === userSlot.id || raw === `${userSlot.provider}/${userSlot.id}`)
  ) {
    return `${userSlot.provider}/${userSlot.id}`;
  }

  const { givenProvider, model } = splitKnownProvider(raw);
  if (!model) return qualifyOpenClawModelId("");

  const apiModel = getCatalogModel(model)?.id ?? model;
  const detected = providerForModelToken(apiModel);
  const fallback = await providerId();
  if (detected && detected !== fallback) {
    return `${detected}/${apiModel}`;
  }
  if (givenProvider) {
    return `${givenProvider}/${apiModel}`;
  }
  return `${detected ?? fallback}/${apiModel}`;
}

const KNOWN_PROVIDER_PREFIX = new Set([
  "deepseek",
  "qwen",
  "mimo",
  "yuntuai",
  "zhipu",
  "moonshot",
  "ark",
  "siliconflow",
  "minimax",
  "spark",
  "hunyuan",
  "custom",
  "openai",
  "anthropic",
]);

/** 只按已知厂商前缀切开。模型 ID 自带的斜杠（如硅基 `deepseek-ai/DeepSeek-V3.2`）保持原文。 */
function splitKnownProvider(raw: string): { givenProvider: string; model: string } {
  const slash = raw.indexOf("/");
  if (slash < 0) return { givenProvider: "", model: raw };
  const head = raw.slice(0, slash).trim();
  if (!KNOWN_PROVIDER_PREFIX.has(head.toLowerCase())) {
    return { givenProvider: "", model: raw };
  }
  return { givenProvider: head, model: raw.slice(slash + 1).trim() };
}

function providerForModelToken(model: string): string | null {
  const catalog = getCatalogModel(model);
  if (
    catalog?.provider &&
    catalog.provider !== "openai" &&
    catalog.provider !== "anthropic"
  ) {
    return catalog.provider;
  }
  const lower = model.toLowerCase();
  if (lower.startsWith("qwen")) return "qwen";
  if (lower.startsWith("mimo")) return "mimo";
  if (lower.startsWith("deepseek")) return "deepseek";
  if (lower.startsWith("glm")) return "zhipu";
  if (lower.startsWith("kimi") || lower.startsWith("moonshot")) return "moonshot";
  if (lower.startsWith("doubao") || lower.startsWith("ep-")) return "ark";
  if (lower.startsWith("minimax") || lower.startsWith("abab")) return "minimax";
  if (lower.startsWith("spark") || lower.startsWith("generalv")) return "spark";
  return null;
}

/** 将当前模型选择写入会话级 override（sessions.patch）。 */
export async function patchSessionModelForSend(
  sessionKey: string,
  selectionId: ModelSelectionId,
): Promise<void> {
  const key = sessionKey.trim();
  if (!key) return;
  const client = getGatewayClient();
  if (!client.isHelloOk) return;

  if (selectionId === AUTO_MODEL_ID) {
    try {
      await client.request("sessions.patch", { key, model: null });
    } catch {
      /* 部分网关版本可能不接受 null */
    }
    return;
  }

  const resolved = getResolvedModelId(selectionId);
  const qualified = await qualifyOpenClawModelId(resolved);
  await client.request("sessions.patch", { key, model: qualified });
}

/** 发送含图片附件前写入视觉模型：中转站回退到 GPT；直连多模态则与主模型一致。 */
export async function patchSessionImageModelForVision(
  sessionKey: string,
  resolvedModelId: string,
): Promise<void> {
  const key = sessionKey.trim();
  if (!key) return;
  const client = getGatewayClient();
  if (!client.isHelloOk) return;

  const profile = await fetchDistributionProfile();
  let visionShort: string;
  if (modelUsesDirectVision(resolvedModelId)) {
    visionShort = resolvedModelId.includes("/")
      ? resolvedModelId.split("/").pop()!
      : resolvedModelId;
  } else if (profile?.profile === "relay-station") {
    visionShort = pickVisionCapableModelId();
  } else {
    return;
  }

  const visionModel = await qualifyOpenClawModelId(visionShort);
  try {
    await client.request("sessions.patch", { key, imageModel: visionModel });
  } catch {
    /* 旧版网关可能不支持会话级 imageModel */
  }
}
