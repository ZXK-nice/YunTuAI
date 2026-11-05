import { PRODUCT_IDENTITY_LABEL } from "../product-brand";

/**
 * 网关 chat.history 中的 user 消息常含仅发往远程的注入块（任务模式、附件上下文、身份约定）。
 * 本地 SQLite 只存用户可见正文；回填时必须归一化后再去重，否则会「多出原本不存在的对话」。
 */

const IDENTITY_HINT_PREFIX = `[${PRODUCT_IDENTITY_LABEL}]`;
const IDENTITY_HINT_SEP = "——\n";

const REMOTE_ONLY_BLOCK_MARKERS = [
  "【云图任务模式】",
  "【云图·回复风格】",
  "【云图·可交付验收】",
  "【云图会话接续】",
  "【输出目录】",
  "[文件上下文]",
  "[文档预提取]",
  "[图片 OCR 预识别]",
  "[用户附件]",
] as const;

const CONTEXT_BRIDGE_MARKER = "【云图会话接续】";

/** 接续块末尾 `---` 之后的用户正文（网关存的是整段 bridge，本地只存短句）。 */
function extractTrailingUserPayload(content: string): string | null {
  const markerIdx = content.indexOf(CONTEXT_BRIDGE_MARKER);
  if (markerIdx < 0) return null;
  const sep = content.lastIndexOf("\n---\n");
  if (sep < 0 || sep <= markerIdx) return null;
  const tail = content.slice(sep + 5).trim();
  return tail || null;
}

/** OpenClaw 恢复运行时会注入的内部续跑提示，不应落库为可见用户消息。 */
const INTERNAL_USER_MESSAGE_RES =
  /^(continue the openclaw runtime event|resume the openclaw runtime event)/i;

/** 去掉仅存在于 remotePayload 的尾部/头部注入，得到与本地展示一致的用户正文。 */
export function normalizeUserMessageForDedup(content: string): string {
  let t = content.trim();
  if (!t) return "";

  if (t.startsWith(IDENTITY_HINT_PREFIX)) {
    const sepIdx = t.indexOf(IDENTITY_HINT_SEP);
    if (sepIdx >= 0) {
      t = t.slice(sepIdx + IDENTITY_HINT_SEP.length).trim();
    }
  }

  for (const marker of REMOTE_ONLY_BLOCK_MARKERS) {
    const idx = t.indexOf(marker);
    if (idx < 0) continue;
    if (marker === CONTEXT_BRIDGE_MARKER) {
      const tail = extractTrailingUserPayload(t);
      if (tail) {
        t = tail;
        break;
      }
    }
    const cut = t.lastIndexOf("\n---\n", idx);
    t = (cut >= 0 ? t.slice(0, cut) : t.slice(0, idx)).trim();
  }

  if (!t && content.includes(CONTEXT_BRIDGE_MARKER)) {
    const tail = extractTrailingUserPayload(content);
    if (tail) t = tail;
  }

  // 附件仅路径引用时的兜底用户句（本地可能是「（附件：xxx）」）
  t = t.replace(
    /^请阅读并处理用户上传的附件（[^）]+）。\s*$/u,
    (_m, names: string) => `（附件：${names}）`,
  );

  return t.trim();
}

export function isInternalGatewayUserMessage(content: string): boolean {
  const t = content.trim();
  if (!t) return true;
  return INTERNAL_USER_MESSAGE_RES.test(t);
}

/** 判断网关 user 行是否与本地 user 气泡为同一条（允许远程侧带注入后缀）。 */
export function userMessagesEquivalent(local: string, gateway: string): boolean {
  const a = normalizeUserMessageForDedup(local);
  const b = normalizeUserMessageForDedup(gateway);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 8 && b.startsWith(a)) return true;
  if (b.length >= 8 && a.startsWith(b)) return true;
  return false;
}

export function shouldSkipGatewayUserBackfill(
  gatewayContent: string,
  localUserMessages: { content: string }[],
): boolean {
  if (isInternalGatewayUserMessage(gatewayContent)) return true;
  const norm = normalizeUserMessageForDedup(gatewayContent);
  if (!norm) return true;
  return localUserMessages.some((m) => userMessagesEquivalent(m.content, gatewayContent));
}
