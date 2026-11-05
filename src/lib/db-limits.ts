/** 与 `src-tauri` 中 `MAX_MSG_BYTES` 一致 */
export const MAX_LOCAL_MESSAGE_UTF8_BYTES = 4 * 1024 * 1024;

export const LOCAL_MESSAGE_TOO_LONG =
  "单条消息体积超过本机限制（约 4MB UTF-8），请缩短或拆成多条。";

export function getUtf8ByteLength(s: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s).length;
  }
  return s.length;
}

export function isWithinLocalMessageLimit(s: string): boolean {
  return getUtf8ByteLength(s) <= MAX_LOCAL_MESSAGE_UTF8_BYTES;
}
