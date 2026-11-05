import type { PendingChatAttachment } from "./message-files";
import { fileIconKind } from "./message-files";
import type { SessionsSendAttachment } from "../openclaw/session-rpc";
import type { MessageFileEntry } from "./message-files";
import { chatReadFileBase64 } from "./chat-files-bridge";
import {
  MAX_VISION_ATTACHMENTS_PER_SEND,
  MAX_VISION_INLINE_BYTES,
} from "./attachment-limits";

export { MAX_VISION_ATTACHMENTS_PER_SEND, MAX_VISION_INLINE_BYTES };

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

export function isImageFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".svg")) return false;
  return fileIconKind(name) === "image";
}

export function mimeTypeForImageFileName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME[ext] ?? "image/png";
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 从待发附件构建 OpenClaw `sessions.send` 的 vision attachments（仅图片）。 */
export async function pendingAttachmentsToVisionAttachments(
  attachments: PendingChatAttachment[],
  readPathBase64: (path: string) => Promise<string | null>,
): Promise<SessionsSendAttachment[]> {
  const out: SessionsSendAttachment[] = [];
  for (const att of attachments) {
    if (!isImageFileName(att.name)) continue;
    if (att.size > MAX_VISION_INLINE_BYTES) continue;

    let content: string | null = null;
    if (att.file) {
      content = await fileToBase64(att.file);
    } else if (att.path?.trim()) {
      content = await readPathBase64(att.path.trim());
    }
    if (!content) continue;

    out.push({
      fileName: att.name,
      mimeType: mimeTypeForImageFileName(att.name),
      content,
    });
  }
  return out;
}

export function capVisionAttachments<T extends { content: string }>(
  attachments: T[],
  maxCount = MAX_VISION_ATTACHMENTS_PER_SEND,
): T[] {
  if (attachments.length <= maxCount) return attachments;
  return attachments.slice(0, maxCount);
}

/** 从已落盘附件与 PPT 幻灯片路径构建视觉附件（多模态模型直传）。 */
export async function buildVisionAttachmentsForSend(
  attachedFiles: MessageFileEntry[],
  extraImagePaths: string[] = [],
): Promise<SessionsSendAttachment[]> {
  const items: Array<{ name: string; path: string }> = [];
  for (const f of attachedFiles) {
    if (!isImageFileName(f.name)) continue;
    items.push({ name: f.name, path: f.path });
  }
  for (const p of extraImagePaths) {
    const path = p.trim();
    if (!path || items.some((x) => x.path === path)) continue;
    const name = path.split(/[/\\]/).pop() ?? "image.png";
    items.push({ name, path });
  }

  const out: SessionsSendAttachment[] = [];
  for (const item of items) {
    if (out.length >= MAX_VISION_ATTACHMENTS_PER_SEND) break;
    const payload = await chatReadFileBase64(item.path);
    if (!payload?.base64) continue;
    const approxBytes = Math.floor(payload.base64.length * 0.75);
    if (approxBytes > MAX_VISION_INLINE_BYTES) continue;
    out.push({
      fileName: item.name,
      mimeType: payload.mimeType || mimeTypeForImageFileName(item.name),
      content: payload.base64,
    });
  }
  return capVisionAttachments(out);
}
