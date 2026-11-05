import { PRODUCT_IDENTITY_LABEL, PRODUCT_NAME } from "../product-brand";

/**
 * 本地界面已统一为「YunTu Control」。首轮消息附加简短称谓与主动办事约定（与 workspace/SOUL.md 互补）。
 * 不写入 SQLite 中的用户消息。
 */
export function withYunTuAiIdentityHint(userMessage: string): string {
  const t = userMessage.trim();
  if (!t) return userMessage;
  return (
    `[${PRODUCT_IDENTITY_LABEL}]\n` +
    `请以「${PRODUCT_NAME}」自称，并遵循 workspace/SOUL.md 与 AGENTS.md：主动办事搭档，而不是只会听指挥的应答器。` +
    "已安装技能默认自动使用，勿要求用户提醒启用。" +
    "若存在 IMPROVEMENTS.md，落实其中近期改进点。\n" +
    "——\n" +
    t
  );
}
