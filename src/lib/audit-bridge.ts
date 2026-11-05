import { invokeAuthed } from "./tauri-invoke";

export type AuditLogRow = {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  detail: string;
};

export async function fetchAuditList(limit = 200): Promise<AuditLogRow[] | null> {
  return invokeAuthed<AuditLogRow[]>("audit_list", { limit });
}

export async function exportAuditJson(): Promise<string | null> {
  return invokeAuthed<string>("audit_export_json");
}

export async function appendAuditEvent(
  category: string,
  action: string,
  detail: string,
): Promise<void> {
  await invokeAuthed("audit_append_event", { category, action, detail });
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
