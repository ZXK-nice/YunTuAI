import { memo, useCallback, useEffect, useState } from "react";
import { openClawWorkspacePath, openOpenClawDataDirInOs, openclawDirStatus } from "../../lib/openclaw/cli-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import { formatUserFacingPath, SERVICE_PATH_LABELS } from "../../lib/product-copy";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

/** 设置 · 系统：本机服务数据与工作区路径。 */
export const DataPathsPanel = memo(function DataPathsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    void openclawDirStatus()
      .then((st) => {
        setDataDir(st?.dir ?? null);
        return openClawWorkspacePath();
      })
      .then((ws) => setWorkspace(ws))
      .finally(() => setLoading(false));
  }, []);

  const tryOpen = useCallback(
    async (path: string) => {
      try {
        await revealPathInOs(path);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [showToast],
  );

  if (!isTauriRuntime()) return null;

  return (
    <div
      id="settings-data-paths"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="font-medium text-[var(--text-primary)]">数据与工作区路径</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        {PRODUCT_NAME} 监管的本机服务数据位于安装目录下的 {SERVICE_PATH_LABELS.dataDir}。
      </p>
      {loading ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">加载中…</p>
      ) : !dataDir ? (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">暂无法读取数据目录，请确认本机服务已安装。</p>
      ) : (
        <div className="mt-3 space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-sm">
          <div>
            <div className="text-xs font-medium text-[var(--text-tertiary)]">数据根目录</div>
            <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">
              {formatUserFacingPath(dataDir)}
            </div>
            <button
              type="button"
              onClick={() => void openOpenClawDataDirInOs()}
              className="mt-2 text-xs font-medium text-[var(--brand-color)] hover:underline"
            >
              在资源管理器中打开
            </button>
          </div>
          {workspace ? (
            <div className="border-t border-[var(--border-subtle)] pt-3">
              <div className="text-xs font-medium text-[var(--text-tertiary)]">工作区</div>
              <div className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">
                {formatUserFacingPath(workspace)}
              </div>
              <button
                type="button"
                onClick={() => void tryOpen(workspace)}
                className="mt-2 text-xs font-medium text-[var(--brand-color)] hover:underline"
              >
                在资源管理器中打开
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});
