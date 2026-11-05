/** 发行档 profile id（与 Rust `distribution_policy::DistributionProfile::id()` 一致）。 */
export const INTERNAL_PROFILE_ID = "internal";
export const RELAY_PROFILE_ID = "relay-station";

/** 历史 profile id，仍视为内部版。 */
export const LEGACY_INTERNAL_PROFILE_IDS = ["deepseek-direct", "deepseek"] as const;

export const INTERNAL_PROFILE_LABEL = "内部版";
export const RELAY_PROFILE_LABEL = "云图中转站";

export function isInternalProfile(profileId: string | null | undefined): boolean {
  if (!profileId?.trim()) return true;
  const p = profileId.trim().toLowerCase();
  return p === INTERNAL_PROFILE_ID || LEGACY_INTERNAL_PROFILE_IDS.includes(p as typeof LEGACY_INTERNAL_PROFILE_IDS[number]);
}

export function isRelayProfile(profileId: string | null | undefined): boolean {
  return profileId?.trim() === RELAY_PROFILE_ID;
}

export function profileDisplayLabel(profileId: string | null | undefined): string {
  if (isRelayProfile(profileId)) return RELAY_PROFILE_LABEL;
  if (isInternalProfile(profileId)) return INTERNAL_PROFILE_LABEL;
  return profileId?.trim() || INTERNAL_PROFILE_LABEL;
}

export function normalizeProfileId(profileId: string | null | undefined): string {
  if (isRelayProfile(profileId)) return RELAY_PROFILE_ID;
  if (isInternalProfile(profileId)) return INTERNAL_PROFILE_ID;
  return profileId?.trim() || INTERNAL_PROFILE_ID;
}
