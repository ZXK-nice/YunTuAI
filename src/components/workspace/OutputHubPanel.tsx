import { memo, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  chatGetOutputDir,
  chatOpenFile,
  chatScanNewOutputFiles,
} from "../../lib/chat/chat-files-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import {
  getTaskDeliverySummary,
  subscribeTaskDelivery,
} from "../../lib/openclaw/task-delivery";
import { formatUserFacingPath } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useSessionStore } from "../../stores/sessionStore";
import { useWorkspaceArtifactStore } from "../../stores/workspaceArtifactStore";
import { useUiStore } from "../../stores/uiStore";

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function fileLabel(path: string): string {
  const norm = path.replace(/\\/g, "/");
  return norm.split("/").pop() ?? path;
}

/** 顶栏「产出」：输出目录与近期文件。 */
export const OutputHubPanel = memo(function OutputHubPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const activeId = useSessionStore((s) => s.activeId);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const deliverySummary = useSyncExternalStore(
    subscribeTaskDelivery,
    () => (activeId ? getTaskDeliverySummary(activeId) : null),
    () => null,
  );

  useEffect(() => {
    return subscribeTaskDelivery(() => undefined);
  }, []);

  const sessionArtifacts = useWorkspaceArtifactStore((s) =>
    activeId ? (s.bySession[activeId] ?? []) : [],
  );

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const dir = await chatGetOutputDir();
      setOutputDir(dir ?? null);
      const since = Date.now() - RECENT_MS;
      const scanned = await chatScanNewOutputFiles(since);
      const paths = scanned?.map((f) => f.path) ?? [];
      setRecentPaths(paths.slice(0, 24));
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void reload();
  }, [reload, activeId]);

  const mergedPaths = useMemo(() => {
    const set = new Set<string>();
    for (const p of deliverySummary?.artifactPaths ?? []) set.add(p);
    for (const a of sessionArtifacts) set.add(a.path);
    for (const p of recentPaths) set.add(p);
    return [...set].slice(0, 20);
  }, [deliverySummary, sessionArtifacts, recentPaths]);

  const onOpenDir = useCallback(async () => {
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

  const onOpenFile = useCallback(
    async (path: string) => {
      try {
        await chatOpenFile(path);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [showToast],
  );

  if (!isTauriRuntime()) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
        产出目录仅在桌面客户端中可用。
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="text-sm font-semibold text-[var(--text-primary)]">产出文件夹</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          办事生成的 Excel、Word、报告等会保存在这里。完成任务后可在右侧任务面板点「打开产出文件夹」。
        </p>
        {loading ? (
          <p className="mt-3 text-xs text-[var(--text-tertiary)]">加载中…</p>
        ) : (
          <p
            className="mt-3 break-all rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] text-[var(--text-secondary)]"
            title={outputDir ?? undefined}
          >
            {outputDir ? formatUserFacingPath(outputDir) : "未设置"}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="yt-btn-svc" onClick={() => void onOpenDir()}>
            打开产出文件夹
          </button>
          <button type="button" className="yt-btn-svc" onClick={() => void reload()}>
            刷新列表
          </button>
        </div>
      </section>

      {deliverySummary && deliverySummary.artifactCount > 0 ? (
        <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--brand-color)_20%,var(--border-subtle))] bg-[var(--brand-tint-8)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">本轮任务</div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{deliverySummary.headline}</p>
        </section>
      ) : null}

      <section className="min-h-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
        <div className="text-sm font-semibold text-[var(--text-primary)]">近期产出</div>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">近 7 天写入产出目录的文件</p>
        {mergedPaths.length === 0 ? (
          <p className="mt-4 text-xs text-[var(--text-tertiary)]">
            暂无文件。在「办事」里拖入表格或文档，说明要什么结果即可。
          </p>
        ) : (
          <ul className="mt-3 space-y-1">
            {mergedPaths.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-md)] px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--brand-color)]"
                  onClick={() => void onOpenFile(path)}
                  title={path}
                >
                  {fileLabel(path)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
});
