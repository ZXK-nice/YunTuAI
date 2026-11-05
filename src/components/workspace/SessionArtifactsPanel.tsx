import { memo, useCallback, useState } from "react";
import { chatInspectDroppedPaths, chatReadTextPreview } from "../../lib/chat/chat-files-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import type { WorkspaceArtifact } from "../../lib/openclaw/workspace-artifacts";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceArtifactStore } from "../../stores/workspaceArtifactStore";

const EMPTY_ARTIFACTS: WorkspaceArtifact[] = [];

const KIND_LABEL = {
  write: "写入",
  read: "读取",
  exec: "执行",
  other: "涉及",
} as const;

const ART_BTN = "yt-btn-svc px-2 py-0.5 text-[10px]";

export const SessionArtifactsPanel = memo(function SessionArtifactsPanel() {
  const activeId = useSessionStore((s) => s.activeId);
  const artifacts = useWorkspaceArtifactStore((s) =>
    activeId ? (s.bySession[activeId] ?? EMPTY_ARTIFACTS) : EMPTY_ARTIFACTS,
  );
  const showToast = useUiStore((s) => s.showToast);
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  const [preview, setPreview] = useState<{ path: string; name: string; content: string; truncated: boolean } | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const openPath = useCallback(
    async (path: string) => {
      if (!isTauriRuntime()) {
        showToast("请在桌面版中打开文件。", "info");
        return;
      }
      try {
        await revealPathInOs(path);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [showToast],
  );

  const copyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        showToast("路径已复制", "success");
      } catch {
        showToast("复制失败", "error");
      }
    },
    [showToast],
  );

  const previewPath = useCallback(
    async (path: string) => {
      if (!isTauriRuntime()) {
        showToast("请在桌面版中预览文件。", "info");
        return;
      }
      setPreviewLoading(path);
      try {
        const res = await chatReadTextPreview(path);
        if (!res?.content) {
          showToast("无法预览此文件（可能不是文本或过大）", "info");
          return;
        }
        setPreview({ path, name: res.name, content: res.content, truncated: res.truncated });
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setPreviewLoading(null);
      }
    },
    [showToast],
  );

  const attachToComposer = useCallback(
    async (path: string) => {
      if (!activeId || !isTauriRuntime()) return;
      try {
        const inspected = await chatInspectDroppedPaths([path]);
        const item = inspected?.[0];
        if (!item) {
          showToast("无法读取文件", "error");
          return;
        }
        const draftKey = activeId;
        const cur = useUiStore.getState().composerDrafts[draftKey] ?? "";
        const fileName = item.name || path.split(/[/\\]/).pop() || "file";
        const quote =
          item.kind === "text" && item.textContent?.trim()
            ? `\n\n---\n【附件：${fileName}】\n${item.textContent.trim().slice(0, 8000)}`
            : `\n\n（已附加文件：${fileName}，路径：${path}）`;
        setComposerDraft(draftKey, cur + quote);
        showToast("已引用到输入框，可编辑后发送", "success");
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [activeId, setComposerDraft, showToast],
  );

  if (!activeId || artifacts.length === 0) return null;

  return (
    <section className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-3">
      <h2 className="text-[13px] font-medium text-[var(--text-secondary)]">本轮产出</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        Agent 工具涉及的文件路径；可预览文本、引用到对话或打开所在目录
      </p>
      <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
        {artifacts.map((a) => (
          <li
            key={a.path}
            className="rounded-md border border-[var(--border-subtle)]/60 bg-[var(--bg-elevated)] px-2 py-1.5"
          >
            <div className="flex min-w-0 items-start gap-1">
              <span className="mt-0.5 shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                {KIND_LABEL[a.kind]}
              </span>
              <span className="min-w-0 flex-1 font-mono text-[11px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                {a.path}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <button type="button" className={ART_BTN} onClick={() => void openPath(a.path)}>
                打开
              </button>
              <button type="button" className={ART_BTN} onClick={() => void previewPath(a.path)} disabled={previewLoading === a.path}>
                {previewLoading === a.path ? "读取中…" : "预览"}
              </button>
              <button type="button" className={ART_BTN} onClick={() => void copyPath(a.path)}>
                复制路径
              </button>
              <button type="button" className={ART_BTN} onClick={() => void attachToComposer(a.path)}>
                引用到对话
              </button>
            </div>
          </li>
        ))}
      </ul>

      {preview && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-app)_55%,transparent)] p-6 backdrop-blur-[2px]"
          role="dialog"
          aria-modal
          aria-labelledby="artifact-preview-title"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[min(80vh,640px)] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
              <h3 id="artifact-preview-title" className="truncate text-sm font-medium text-[var(--text-primary)]">
                {preview.name}
              </h3>
              <button
                type="button"
                className="yt-transition rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                onClick={() => setPreview(null)}
              >
                关闭
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {preview.content}
              {preview.truncated ? "\n\n…（内容已截断）" : ""}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
});
