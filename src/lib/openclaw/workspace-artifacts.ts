/** 从网关 tool 事件提取工作区文件路径，供右侧面板展示。 */

export type WorkspaceArtifactKind = "write" | "read" | "exec" | "other";

export type WorkspaceArtifact = {
  path: string;
  kind: WorkspaceArtifactKind;
  toolName?: string;
  at: string;
};

const PATH_KEY_RE =
  /^(path|file|filepath|filename|resolvedpath|target|destination|output|source|cwd)$/i;

const WRITE_RE = /write|edit|patch|save|create|mkdir|touch|append/i;
const READ_RE = /read|cat|load|list|glob|search/i;
const EXEC_RE = /exec|run|shell|bash|cmd|process/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function normalizePath(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, "");
  if (!t || t.length > 512) return null;
  if (/^https?:\/\//i.test(t)) return null;
  if (t.includes("\n")) return null;
  return t;
}

function collectPaths(obj: Record<string, unknown>, out: Set<string>, depth = 0): void {
  if (depth > 4) return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && PATH_KEY_RE.test(k)) {
      const p = normalizePath(v);
      if (p) out.add(p);
    } else if (isRecord(v)) {
      collectPaths(v, out, depth + 1);
    } else if (Array.isArray(v) && PATH_KEY_RE.test(k)) {
      for (const item of v) {
        if (typeof item === "string") {
          const p = normalizePath(item);
          if (p) out.add(p);
        }
      }
    }
  }
}

function inferKind(toolName: string, event: string): WorkspaceArtifactKind {
  const hay = `${toolName} ${event}`.toLowerCase();
  if (WRITE_RE.test(hay)) return "write";
  if (READ_RE.test(hay)) return "read";
  if (EXEC_RE.test(hay)) return "exec";
  return "other";
}

function toolNameFromPayload(p: Record<string, unknown>): string {
  const d = isRecord(p.data) ? p.data : null;
  for (const src of [p, d ?? {}]) {
    for (const key of ["name", "tool", "command"] as const) {
      const v = src[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}

/** 从单条网关事件提取 0..n 个工作区路径。 */
export function extractWorkspaceArtifacts(event: string, payload: unknown): WorkspaceArtifact[] {
  const el = event.toLowerCase();
  if (!el.includes("tool") && !el.startsWith("session.")) return [];
  if (!isRecord(payload)) return [];

  const toolName = toolNameFromPayload(payload);
  const kind = inferKind(toolName, el);
  const paths = new Set<string>();
  collectPaths(payload, paths);
  if (isRecord(payload.data)) collectPaths(payload.data, paths);

  const at = new Date().toISOString();
  return [...paths].map((path) => ({ path, kind, toolName: toolName || undefined, at }));
}

export function mergeArtifacts(
  existing: WorkspaceArtifact[],
  incoming: WorkspaceArtifact[],
  max = 40,
): WorkspaceArtifact[] {
  const map = new Map<string, WorkspaceArtifact>();
  for (const a of [...existing, ...incoming]) {
    const prev = map.get(a.path);
    if (!prev || a.at > prev.at) map.set(a.path, a);
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}
