import { chatWriteOfficeOutput, type ChatSavedFile } from "./chat-files-bridge";
import { useUiStore } from "../../stores/uiStore";

export type OfficeWriteFormat = "csv" | "xlsx" | "docx";

export type OfficeWritePayload = {
  format: OfficeWriteFormat;
  filename: string;
  rows?: string[][];
  paragraphs?: string[];
};

const FENCE_RE = /```(?:yuntu-office-write|json:yuntu-office)\s*\n([\s\S]*?)```/gi;

function isOfficeWriteFormat(v: unknown): v is OfficeWriteFormat {
  return v === "csv" || v === "xlsx" || v === "docx";
}

function asStringGrid(raw: unknown): string[][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const rows: string[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) return undefined;
    rows.push(row.map((cell) => (cell == null ? "" : String(cell))));
  }
  return rows;
}

function asStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((item) => (item == null ? "" : String(item)));
}

export function parseOfficeWritePayload(raw: string): OfficeWritePayload | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (!isOfficeWriteFormat(rec.format)) return null;
  const filename = typeof rec.filename === "string" ? rec.filename.trim() : "";
  if (!filename) return null;
  const rows = asStringGrid(rec.rows);
  const paragraphs = asStringList(rec.paragraphs);
  if (rec.format === "docx") {
    if (!paragraphs || paragraphs.length === 0) return null;
    return { format: rec.format, filename, paragraphs };
  }
  if (!rows || rows.length === 0) return null;
  return { format: rec.format, filename, rows };
}

export function parseOfficeWriteBackPayloads(text: string): OfficeWritePayload[] {
  const out: OfficeWritePayload[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(FENCE_RE)) {
    const payload = parseOfficeWritePayload(match[1] ?? "");
    if (!payload) continue;
    const key = `${payload.format}\0${payload.filename}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(payload);
  }
  return out;
}

export function stripOfficeWriteFences(text: string): string {
  return text
    .replace(FENCE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function applyOfficeWriteBackFromAssistant(text: string): Promise<ChatSavedFile[]> {
  const payloads = parseOfficeWriteBackPayloads(text);
  if (payloads.length === 0) return [];
  const saved: ChatSavedFile[] = [];
  for (const payload of payloads) {
    try {
      const file = await chatWriteOfficeOutput(payload.format, payload.filename, {
        rows: payload.rows,
        paragraphs: payload.paragraphs,
      });
      if (file) saved.push(file);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[office-write-back]", payload.filename, message);
      useUiStore.getState().showToast(`办公文件未写入：${payload.filename}（${message}）`, "error");
    }
  }
  return saved;
}
