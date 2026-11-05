import { findLegacyOfficeNames, legacyOfficeUserMessage } from "./office-legacy-formats";

export type PendingAttachmentGuardResult =
  | { ok: true }
  | { ok: false; message: string; blockedNames: string[] };

/** 附件加入待发送列表前的统一校验（大小校验在调用方）。 */
export function guardPendingAttachmentNames(names: readonly string[]): PendingAttachmentGuardResult {
  const blocked = findLegacyOfficeNames(names);
  if (blocked.length === 0) return { ok: true };
  const first = blocked[0]!;
  return {
    ok: false,
    message: legacyOfficeUserMessage(first),
    blockedNames: blocked,
  };
}
