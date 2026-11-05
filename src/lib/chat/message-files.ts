/** 消息气泡内附件元数据，存于 local_messages.display_content（JSON）。 */

export type MessageFileEntry = {
  name: string;
  path: string;
  size?: number;
};

export type MessageFilesPayload = {
  v: 1 | 2;
  text?: string;
  files: MessageFileEntry[];
  /** v=2：助手消息的思考过程（折叠显示） */
  thinking?: string;
};

export function encodeMessageDisplayContent(
  text: string,
  files: MessageFileEntry[],
): string | undefined {
  if (!files.length) return undefined;
  const payload: MessageFilesPayload = {
    v: 1,
    text: text.trim() || undefined,
    files,
  };
  return JSON.stringify(payload);
}

/** 编码助手消息的 display_content，包含折叠思考过程（v=2）。 */
export function encodeMessageDisplayContentV2(
  text: string,
  thinking: string | undefined,
  files: MessageFileEntry[],
): string | undefined {
  if (!thinking?.trim() && !files.length) return undefined;
  const payload: MessageFilesPayload = {
    v: 2,
    text: text.trim() || undefined,
    thinking: thinking?.trim() || undefined,
    files: files.length > 0 ? files : [],
  };
  return JSON.stringify(payload);
}

export type ParsedDisplayContent = {
  text: string;
  files: MessageFileEntry[];
  thinking?: string;
};

export function parseMessageDisplayContent(
  displayContent: string | null | undefined,
  fallbackContent: string,
): ParsedDisplayContent {
  if (!displayContent?.trim()) {
    return { text: fallbackContent, files: [] };
  }
  const raw = displayContent.trim();
  if (!raw.startsWith("{")) {
    return { text: raw || fallbackContent, files: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MessageFilesPayload>;
    if ((parsed.v === 1 || parsed.v === 2) && Array.isArray(parsed.files)) {
      const files = parsed.files.filter(
        (f): f is MessageFileEntry =>
          Boolean(f && typeof f.name === "string" && typeof f.path === "string"),
      );
      const thinking =
        parsed.v === 2 && typeof parsed.thinking === "string" && parsed.thinking.trim()
          ? parsed.thinking.trim()
          : undefined;
      return {
        text: (parsed.text ?? fallbackContent).trim() || fallbackContent,
        files,
        thinking,
      };
    }
  } catch {
    /* legacy plain display_content */
  }
  return { text: raw || fallbackContent, files: [] };
}

export function formatFileSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIconKind(name: string): "doc" | "sheet" | "image" | "code" | "file" {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  if (/\.(docx?|wps|rtf|odt|pdf)$/.test(lower)) return "doc";
  if (/\.(xlsx?|csv|ods)$/.test(lower)) return "sheet";
  if (/\.(js|ts|tsx|jsx|py|rs|go|java|cpp|c|h|md|json|yaml|yml|html|css)$/.test(lower)) return "code";
  return "file";
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

const TEXT_EXT =
  /\.(md|txt|json|js|ts|tsx|jsx|py|rs|html|css|xml|yaml|yml|csv|log|ini|toml|env)$/i;

export function isProbablyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  return TEXT_EXT.test(file.name);
}

export type PendingChatAttachment = {
  id: string;
  name: string;
  kind: "text" | "binary";
  content?: string;
  file?: File;
  /** Tauri 原生拖放得到的本机路径 */
  path?: string;
  size: number;
  /** 本地预提取 / OCR 状态（仅 UI 提示） */
  extractStatus?: "pending" | "extracting" | "ocr_ok" | "ocr_empty" | "ocr_fail" | "office_ok" | "office_fail";
  extractHint?: string;
};

export async function filesToPendingAttachments(files: File[]): Promise<PendingChatAttachment[]> {
  const out: PendingChatAttachment[] = [];
  for (const file of files) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (isProbablyTextFile(file)) {
      try {
        const text = await file.text();
        out.push({ id, name: file.name, kind: "text", content: text, file, size: file.size });
      } catch {
        out.push({ id, name: file.name, kind: "binary", file, size: file.size });
      }
    } else {
      out.push({ id, name: file.name, kind: "binary", file, size: file.size });
    }
  }
  return out;
}

export async function pendingAttachmentsToUploadPayload(
  attachments: PendingChatAttachment[],
): Promise<Array<{ name: string; dataBase64: string }>> {
  const entries: Array<{ name: string; dataBase64: string }> = [];
  for (const a of attachments) {
    if (a.path) continue;
    if (a.kind === "text" && a.content != null) {
      entries.push({ name: a.name, dataBase64: btoa(unescape(encodeURIComponent(a.content))) });
    } else if (a.file) {
      entries.push({ name: a.name, dataBase64: await fileToBase64(a.file) });
    }
  }
  return entries;
}

export function pendingAttachmentPaths(attachments: PendingChatAttachment[]): string[] {
  return attachments.map((a) => a.path).filter((p): p is string => Boolean(p?.trim()));
}

export const MAX_ATTACHMENT_BYTES = 48 * 1024 * 1024;
