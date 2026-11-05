import { invokeAuthed, isDesktopOnlyError } from "../tauri-invoke";
import type { MessageFileEntry, PendingChatAttachment } from "./message-files";

export type ChatSavedFile = {
  name: string;
  path: string;
  size: number;
};

export type InspectedDroppedFile = {
  name: string;
  path: string;
  size: number;
  kind: "text" | "binary";
  textContent?: string;
};

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs?: number,
): Promise<T | null> {
  try {
    return await invokeAuthed<T>(cmd, args ?? {}, timeoutMs ? { timeoutMs } : undefined);
  } catch (e) {
    if (isDesktopOnlyError(e)) return null;
    throw e;
  }
}

/** OCR / LibreOffice 预提取在真文件上常超过默认 10 秒。转换本身最多 180 秒，后面还有 OCR。 */
const OFFICE_EXTRACT_TIMEOUT_MS = 600_000;
const OFFICE_SAVE_TIMEOUT_MS = 180_000;
const OFFICE_READ_TIMEOUT_MS = 120_000;

export async function chatGetOutputDir(): Promise<string | null> {
  return safeInvoke<string>("chat_get_output_dir");
}

export async function chatSetOutputDir(path: string): Promise<string | null> {
  return safeInvoke<string>("chat_set_output_dir", { path });
}

export async function chatPickOutputFolder(): Promise<string | null> {
  return safeInvoke<string | null>("chat_pick_output_folder");
}

export async function chatSaveUploadFiles(
  batchId: string,
  files: Array<{ name: string; dataBase64: string }>,
): Promise<ChatSavedFile[] | null> {
  return safeInvoke<ChatSavedFile[]>("chat_save_upload_files", {
    batchId,
    files,
    copyToWorkspace: true,
  }, OFFICE_SAVE_TIMEOUT_MS);
}

export async function chatSaveUploadPaths(
  batchId: string,
  paths: string[],
): Promise<ChatSavedFile[] | null> {
  return safeInvoke<ChatSavedFile[]>("chat_save_upload_paths", {
    batchId,
    paths,
    copyToWorkspace: true,
  }, OFFICE_SAVE_TIMEOUT_MS);
}

export async function chatReadTextPreview(
  path: string,
  maxBytes?: number,
): Promise<{ name: string; content: string; truncated: boolean } | null> {
  return safeInvoke<{ name: string; content: string; truncated: boolean }>("chat_read_text_preview", {
    path,
    maxBytes,
  }, OFFICE_READ_TIMEOUT_MS);
}

export async function chatReadFileBase64(
  path: string,
): Promise<{ base64: string; mimeType: string } | null> {
  return safeInvoke<{ base64: string; mimeType: string }>("chat_read_file_base64", { path }, OFFICE_READ_TIMEOUT_MS);
}

export type OfficeExtractResult = {
  kind: string;
  slideCount: number;
  textPreview: string;
  imagePaths: string[];
  imageOnly: boolean;
  ocrPreview: string;
};

export type OcrImageResult = {
  path: string;
  name: string;
  text: string;
  engine: string;
  ok: boolean;
  error?: string | null;
};

export async function chatExtractOfficeContext(
  path: string,
  batchId: string,
  opts?: { skipOcr?: boolean },
): Promise<OfficeExtractResult | null> {
  return safeInvoke<OfficeExtractResult>(
    "chat_extract_office_context",
    {
      path,
      batchId,
      skipOcr: opts?.skipOcr ?? null,
    },
    OFFICE_EXTRACT_TIMEOUT_MS,
  );
}

export async function chatOcrImagePaths(paths: string[]): Promise<OcrImageResult[] | null> {
  if (paths.length === 0) return [];
  return safeInvoke<OcrImageResult[]>("chat_ocr_image_paths", { paths }, OFFICE_EXTRACT_TIMEOUT_MS);
}

export async function chatWriteOfficeOutput(
  format: "csv" | "xlsx" | "docx",
  filename: string,
  data: { rows?: string[][]; paragraphs?: string[] },
): Promise<ChatSavedFile | null> {
  return safeInvoke<ChatSavedFile>(
    "chat_write_office_output",
    {
      format,
      filename,
      dataJson: JSON.stringify(data),
    },
    OFFICE_SAVE_TIMEOUT_MS,
  );
}

export async function chatInspectDroppedPaths(
  paths: string[],
): Promise<InspectedDroppedFile[] | null> {
  return safeInvoke<InspectedDroppedFile[]>("chat_inspect_dropped_paths", { paths }, OFFICE_READ_TIMEOUT_MS);
}

export async function chatOpenFile(path: string): Promise<void> {
  await invokeAuthed("chat_open_file", { path });
}

export async function chatScanNewOutputFiles(sinceMs: number): Promise<MessageFileEntry[] | null> {
  return safeInvoke<MessageFileEntry[]>("chat_scan_new_output_files", { sinceMs }, OFFICE_READ_TIMEOUT_MS);
}

export function toMessageFileEntries(saved: ChatSavedFile[]): MessageFileEntry[] {
  return saved.map((f) => ({ name: f.name, path: f.path, size: f.size }));
}

export function inspectedToPendingAttachments(items: InspectedDroppedFile[]): PendingChatAttachment[] {
  return items.map((item) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: item.name,
    kind: item.kind,
    content: item.textContent,
    path: item.path,
    size: item.size,
  }));
}
