import { getItem, setItem } from "../safeStorage";
import { getGatewayClient } from "./gateway-runtime";
import { getActiveModelForRequest } from "../models/model-api";
import { useModelStore } from "../../stores/modelStore";
import { AUTO_MODEL_ID } from "../../types/model";
import { fetchDistributionProfile } from "./env-bridge";
import { isInternalProfile } from "../distribution-profile";

const STORAGE_KEY = "yuntuai:deep-thinking";

/** 默认开启（与 DeepSeek V4 API 默认 thinking high 对齐）；关闭后写入 localStorage `0`。 */
export function readDeepThinkingEnabled(): boolean {
  const raw = getItem(STORAGE_KEY);
  if (raw === "0") return false;
  if (raw === "1") return true;
  return true;
}

export function persistDeepThinkingEnabled(enabled: boolean): void {
  setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export function isDeepSeekThinkingCapableModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  const short = id.includes("/") ? id.split("/").pop() ?? id : id;
  return (
    short.startsWith("deepseek-v4") ||
    short.startsWith("deepseek-v3") ||
    short === "deepseek-reasoner" ||
    short === "deepseek-r1"
  );
}

export async function shouldOfferDeepThinkingToggle(): Promise<boolean> {
  const profile = await fetchDistributionProfile();
  if (isInternalProfile(profile?.profile)) return true;
  const selectionId = useModelStore.getState().selectionId;
  const resolved = getActiveModelForRequest(selectionId);
  return isDeepSeekThinkingCapableModel(resolved);
}

/** 发送前写入会话级 DeepSeek thinking 开关（sessions.patch）。 */
export async function patchSessionThinkingForSend(
  sessionKey: string,
  enabled: boolean,
): Promise<void> {
  const key = sessionKey.trim();
  if (!key) return;
  const client = getGatewayClient();
  if (!client.isHelloOk) return;

  const body: Record<string, unknown> = enabled
    ? {
        key,
        thinking: { type: "enabled" },
        reasoning_effort: "medium",
      }
    : {
        key,
        thinking: { type: "disabled" },
      };

  try {
    await client.request("sessions.patch", body);
    return;
  } catch {
    /* 部分网关版本字段名不同，尝试嵌套 providerOptions */
  }

  try {
    await client.request("sessions.patch", {
      key,
      providerOptions: {
        deepseek: enabled
          ? { thinking: { type: "enabled" }, reasoning_effort: "medium" }
          : { thinking: { type: "disabled" } },
      },
    });
  } catch {
    /* 不阻断发送；V4 默认仍可能带 thinking */
  }
}

export function resolveThinkingEnabledForSend(): boolean {
  const selectionId = useModelStore.getState().selectionId;
  const resolved =
    selectionId === AUTO_MODEL_ID
      ? getActiveModelForRequest(selectionId)
      : getActiveModelForRequest(selectionId);
  if (!isDeepSeekThinkingCapableModel(resolved)) return false;
  return readDeepThinkingEnabled();
}
