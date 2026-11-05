import { memo, useCallback, useEffect, useState } from "react";
import {
  chatGetOutputDir,
  chatPickOutputFolder,
  chatSetOutputDir,
} from "../../lib/chat/chat-files-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import { formatUserFacingPath } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

/** 设置 · 通用：AI 生成文件的保存位置。 */
export const OutputDirSettingsPanel = memo(function OutputDirSettingsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setLoading(true);
    try {
      const dir = await chatGetOutputDir();
      setOutputDir(dir ?? null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onPick = useCallback(async () => {
    try {
      const picked = await chatPickOutputFolder();
      if (!picked) return;
      const saved = await chatSetOutputDir(picked);
      if (!saved) {
        showToast("保存产出目录失败，请重试", "error");
        return;
      }
      setOutputDir(saved);
      showToast("产出目录已更新", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [showToast]);

  const onOpen = useCallback(async () => {
    const dir = outputDir ?? (await chatGetOutputDir());
    if (!dir?.trim()) {
      showToast("尚未设置产出目录", "info");
      return;
    }
    try {
      await revealPathInOs(dir);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [outputDir, showToast]);

  if (!isTauriRuntime()) return null;

  return (
    <div
      id="settings-output-dir"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="font-medium text-[var(--text-primary)]">AI 产出目录</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        Agent 生成的 Excel、Word、报告等文件将保存到此文件夹。对话中也可在回复里点击文件打开。
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">加载中…</p>
      ) : (
        <p
          className="mt-3 break-all rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]"
          title={outputDir ?? undefined}
        >
          {outputDir ? formatUserFacingPath(outputDir) : "未设置"}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onOpen()}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)]"
        >
          打开文件夹
        </button>
        <button
          type="button"
          onClick={() => void onPick()}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--brand-color)] hover:bg-[var(--brand-surface-select)]"
        >
          选择文件夹…
        </button>
      </div>
    </div>
  );
});
