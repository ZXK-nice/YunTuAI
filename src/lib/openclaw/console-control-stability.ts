/**
 * 控制台写操作后的连接稳定保障 + 内部版配置保护。
 */

import { isInternalProfile } from "../distribution-profile";
import { fetchDistributionProfile } from "./env-bridge";
import { getGatewayClient } from "./gateway-runtime";
import { useGatewayStore } from "../../stores/gatewayStore";

let profileCache: { profile: string; at: number } | null = null;
const PROFILE_CACHE_MS = 60_000;

export async function getCachedDistributionProfile(): Promise<string | null> {
  const now = Date.now();
  if (profileCache && now - profileCache.at < PROFILE_CACHE_MS) {
    return profileCache.profile;
  }
  const info = await fetchDistributionProfile();
  const profile = info?.profile?.trim() ?? null;
  if (profile) profileCache = { profile, at: now };
  return profile;
}

export function isInternalDistributionProfile(profile: string | null): boolean {
  return isInternalProfile(profile);
}

/** @deprecated 使用 isInternalDistributionProfile */
export function isDeepseekDirectProfile(profile: string | null): boolean {
  return isInternalDistributionProfile(profile);
}

/** 内部版：禁止控制台 patch 误删 provider 或写入中转站配置。 */
export function validateConfigPatchForProfile(
  patch: Record<string, unknown>,
  profile: string | null,
): string | null {
  if (!isInternalDistributionProfile(profile)) return null;

  const models = patch.models;
  if (!models || typeof models !== "object") return null;
  const providers = (models as Record<string, unknown>).providers;
  if (!providers || typeof providers !== "object") return null;
  const pmap = providers as Record<string, unknown>;

  if ("yuntuai" in pmap) {
    return "当前为内部版，不允许通过控制台写入中转站（yuntuai）provider。";
  }
  if (pmap.deepseek === null) {
    return "当前为内部版，不允许删除 deepseek provider。";
  }
  const deepseek = pmap.deepseek;
  if (deepseek && typeof deepseek === "object") {
    const baseUrl = (deepseek as Record<string, unknown>).baseUrl;
    if (typeof baseUrl === "string" && !baseUrl.includes("deepseek")) {
      return "内部版不允许将 DeepSeek baseUrl 改离 api.deepseek.com。";
    }
  }
  return null;
}

/**
 * 写操作后轻量 health 探活：不触发重连风暴，仅在失败时提示用户。
 */
export async function probeGatewayAfterControlMutation(): Promise<boolean> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return false;
  if (useGatewayStore.getState().connState !== "connected") return false;
  try {
    await client.request("health", {}, { timeoutMs: 8_000 });
    return true;
  } catch {
    useGatewayStore.setState({
      lastError: "控制操作已完成，但网关探活失败。若聊天异常请在顶栏「手动重连」，无需重启应用。",
    });
    return false;
  }
}

export async function invalidateDistributionProfileCache(): Promise<void> {
  profileCache = null;
}
