import { openUrl } from "@tauri-apps/plugin-opener";
import { isInternalProfile, isRelayProfile } from "./distribution-profile";
import { isTauriRuntime } from "./tauri-env";

/** DeepSeek 开放平台 — 充值 */
export const DEEPSEEK_TOP_UP_URL = "https://platform.deepseek.com/top_up";
/** DeepSeek 开放平台 — 用量/余额 */
export const DEEPSEEK_USAGE_URL = "https://platform.deepseek.com/usage";
/** 小米 MiMo 开放平台 */
export const MIMO_CONSOLE_URL = "https://mimo.mi.com";
/** 中转站运营门户（relay-station 发行档） */
export const DOOHUAN_PORTAL_URL = "https://api.doohuan.com/";

export type BillingPortalTarget = "recharge" | "balance";

export function billingPortalUrl(
  profileId: string | null | undefined,
  target: BillingPortalTarget,
): string {
  if (isRelayProfile(profileId)) {
    return DOOHUAN_PORTAL_URL;
  }
  if (isInternalProfile(profileId)) {
    return target === "recharge" ? DEEPSEEK_TOP_UP_URL : DEEPSEEK_USAGE_URL;
  }
  return target === "recharge" ? DEEPSEEK_TOP_UP_URL : DEEPSEEK_USAGE_URL;
}

export async function openBillingPortal(
  profileId: string | null | undefined,
  target: BillingPortalTarget,
): Promise<void> {
  const url = billingPortalUrl(profileId, target);
  try {
    if (isTauriRuntime()) {
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
