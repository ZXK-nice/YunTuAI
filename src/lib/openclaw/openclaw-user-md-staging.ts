/**
 * OpenClaw 网关 `agents.files.set` 的 `name` 只能是允许列表中的**根文件名**
 *（如 USER.md、TOOLS.md），不能使用 `uploads/...` 子路径。
 * 云图AI 将多附件合并前置写入 `USER.md`，避免 `unsupported file`。
 *
 * 大文件改为「路径引用 + 短预览」，避免 USER.md / 模型上下文膨胀。
 */
import { getUtf8ByteLength } from "../db-limits";
import { PRODUCT_NAME } from "../product-brand";

export const OPENCLAW_STAGING_USER_FILENAME = "USER.md";

/** 合并后 `USER.md` 总 UTF-8 上限（含原有内容），防止无限膨胀撑爆磁盘与上下文。 */
export const MAX_USER_MD_MERGED_UTF8_BYTES = 4 * 1024 * 1024;

/** 超过此字符数的正文改为路径引用 + 预览，不再全文写入 USER.md。 */
export const INLINE_STAGING_CONTENT_MAX_CHARS = 6_000;

/** 路径引用模式下写入 USER.md 的预览长度。 */
export const PATH_REF_PREVIEW_CHARS = 800;

export function extractAgentsFilesGetContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const file = (payload as Record<string, unknown>).file;
  if (!file || typeof file !== "object") return "";
  const f = file as Record<string, unknown>;
  if (f.missing === true) return "";
  const c = f.content;
  return typeof c === "string" ? c : "";
}

function fenceForFilename(displayName: string): string {
  const ext = displayName.includes(".") ? displayName.split(".").pop()!.toLowerCase() : "";
  if (ext === "json" || ext === "jsonc") return "json";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") return "javascript";
  if (ext === "yml" || ext === "yaml") return "yaml";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "css") return "css";
  if (ext === "xml") return "xml";
  if (ext === "csv") return "csv";
  return "text";
}

export type StagingFileSlice = {
  displayName: string;
  content: string;
  /** 工作区内相对路径，如 workspace/inbox/{batchId}/a.md */
  workspaceRelPath?: string;
};

export function workspaceInboxRelPath(batchId: string, displayName: string): string {
  const safe = displayName.replace(/[/\\]/g, "_").trim() || "file";
  return `workspace/inbox/${batchId.trim()}/${safe}`;
}

/** 是否应使用路径引用而非全文内嵌。 */
export function shouldUsePathReference(content: string): boolean {
  return content.length > INLINE_STAGING_CONTENT_MAX_CHARS;
}

export function buildUserMdStagingSection(
  batchId: string,
  files: StagingFileSlice[],
  isoTime: string = new Date().toISOString(),
): string {
  const lines: string[] = [
    `<!-- yuntuai-staging:${batchId} -->`,
    "",
    `## ${PRODUCT_NAME} · 本轮附件（${isoTime}）`,
    "",
    "> 大文件仅保留路径引用与短预览；请优先用工具读取 `workspace/inbox/` 下完整文件。处理后可删除本段。",
    "",
  ];
  for (const { displayName, content, workspaceRelPath } of files) {
    const rel =
      workspaceRelPath?.trim() || workspaceInboxRelPath(batchId, displayName);
    const lang = fenceForFilename(displayName);
    const useRef = shouldUsePathReference(content);

    lines.push(`### ${displayName}`, "");
    lines.push(`- 工作区路径：\`${rel}\``);
    if (useRef) {
      const preview = content.slice(0, PATH_REF_PREVIEW_CHARS).replace(/\r\n/g, "\n");
      const omitted = content.length - preview.length;
      lines.push(
        `- 模式：路径引用（全文约 ${content.length} 字，已省略 ${omitted} 字）`,
        "",
        "预览：",
        "",
        "```" + lang,
        preview + (omitted > 0 ? "\n…（后续请直接读取工作区文件）" : ""),
        "```",
        "",
      );
    } else {
      lines.push(
        "- 模式：全文内嵌",
        "",
        "```" + lang,
        content.replace(/\r\n/g, "\n"),
        "```",
        "",
      );
    }
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function prependStagingToUserMd(existing: string, staging: string): string {
  const tail = existing.replace(/^\uFEFF/, "");
  if (!tail.trim()) return staging;
  return `${staging}${tail}`;
}

export function assertMergedUserMdWithinLimit(merged: string): void {
  if (getUtf8ByteLength(merged) > MAX_USER_MD_MERGED_UTF8_BYTES) {
    throw new Error(
      `合并后 USER.md 超过上限（约 ${Math.floor(MAX_USER_MD_MERGED_UTF8_BYTES / (1024 * 1024))}MB UTF-8），请减少附件或手动清理 USER.md 后重试。`,
    );
  }
}
