import { memo, useCallback, useEffect, useState } from "react";
import { chatPickOutputFolder } from "../../lib/chat/chat-files-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  fetchModuleList,
  installModuleFromDir,
  uninstallModule,
  setModuleEnabled,
  scanModuleDir,
  validateModuleManifest,
  type ModuleInfo,
  type ScannedModuleEntry,
} from "../../lib/module-bridge";

const permissionLabels: Record<string, string> = {
  file_write: "写入文件",
  file_read: "读取文件",
  process_spawn: "启动子进程（如启动 AutoCAD）",
  network: "网络访问",
  clipboard: "剪贴板访问",
};

function permissionLabel(p: string): string {
  return permissionLabels[p] ?? p;
}

const ModuleCard = memo(function ModuleCard({
  info,
  onRefresh,
}: {
  info: ModuleInfo;
  onRefresh: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const [toggling, setToggling] = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const handleToggle = useCallback(async () => {
    setToggling(true);
    try {
      await setModuleEnabled(info.manifest.id, !info.enabled);
      showToast(
        `模块「${info.manifest.name}」已${info.enabled ? "停用" : "启用"}`,
        "success",
      );
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setToggling(false);
    }
  }, [info, onRefresh, showToast]);

  const executeUninstall = useCallback(async () => {
    setConfirmUninstall(false);
    try {
      await uninstallModule(info.manifest.id);
      showToast(`模块「${info.manifest.name}」已卸载`, "success");
      onRefresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [info, onRefresh, showToast]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--text-primary)]">{info.manifest.name}</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">v{info.manifest.version}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                info.enabled
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-neutral-500/20 text-neutral-400"
              }`}
            >
              {info.enabled ? "已启用" : "已停用"}
            </span>
          </div>
          {info.manifest.description ? (
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {info.manifest.description}
            </p>
          ) : null}
        </div>
      </div>

      {info.manifest.tools.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
            工具 ({info.manifest.tools.length})：
          </span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {info.manifest.tools.map((t) => (
              <span
                key={t.name}
                className="rounded-md bg-[var(--surface-glass)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
              >
                {t.name}
                {t.description ? ` — ${t.description.slice(0, 60)}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {info.manifest.permissions.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-medium text-[var(--text-tertiary)]">权限：</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {info.manifest.permissions.map((p) => (
              <span
                key={p}
                className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300/80"
              >
                {permissionLabel(p)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 运行时 + 路径 */}
      <div className="mt-2 space-y-0.5 text-[10px] text-[var(--text-tertiary)]">
        <div>
          运行时：{info.manifest.runtime.type} · {info.manifest.runtime.command}{" "}
          {info.manifest.runtime.args.join(" ")}
        </div>
        <div className="truncate" title={info.path}>
          路径：{info.path}
        </div>
        {info.installedAt ? <div>安装时间：{new Date(info.installedAt).toLocaleString()}</div> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="yt-btn-svc"
          disabled={toggling}
          onClick={handleToggle}
        >
          {toggling ? "处理中…" : info.enabled ? "停用" : "启用"}
        </button>
        <button
          type="button"
          className="yt-btn-svc text-rose-300 hover:border-rose-500/50"
          onClick={() => setConfirmUninstall(true)}
        >
          卸载
        </button>
      </div>
      <ConfirmDialog
        open={confirmUninstall}
        title="卸载模块"
        titleId="oc-module-uninstall-title"
        variant="danger"
        confirmLabel="卸载"
        onClose={() => setConfirmUninstall(false)}
        onConfirm={() => void executeUninstall()}
      >
        <p>
          确定卸载模块「<span className="font-medium text-[var(--text-primary)]">{info.manifest.name}</span>」？
        </p>
      </ConfirmDialog>
    </div>
  );
});

export const ModuleManagerPanel = memo(function ModuleManagerPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannedModules, setScannedModules] = useState<ScannedModuleEntry[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchModuleList();
      setModules(list ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    /* 延迟到初始渲染完成后执行，避免与其它面板的即时 IPC 并发冲击 */
    const t = setTimeout(() => void refresh(), 80);
    return () => clearTimeout(t);
  }, [refresh]);

  const handleInstall = useCallback(async () => {
    const dir = await chatPickOutputFolder();
    if (!dir?.trim()) return;

    setInstalling(true);
    try {
      const result = await installModuleFromDir(dir.trim());
      if (result) {
        showToast(`模块「${result.manifest.name}」安装成功`, "success");
        void refresh();
      }
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : String(e),
        "error",
      );
    } finally {
      setInstalling(false);
    }
  }, [refresh, showToast]);

  const handleScan = useCallback(async () => {
    const dir = await chatPickOutputFolder();
    if (!dir?.trim()) return;
    setScanning(true);
    setScannedModules([]);
    try {
      const manifest = await validateModuleManifest(dir.trim()).catch(() => null);
      if (manifest) {
        setScannedModules([{ manifest, sourceDir: dir.trim() }]);
        showToast(`发现模块: ${manifest.name} v${manifest.version}`, "success");
        return;
      }
      const entries = await scanModuleDir(dir.trim());
      setScannedModules(entries);
      showToast(`发现 ${entries.length} 个模块`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setScanning(false);
    }
  }, [showToast]);

  const handleInstallScanned = useCallback(
    async (entry: ScannedModuleEntry) => {
      setInstalling(true);
      try {
        const result = await installModuleFromDir(entry.sourceDir);
        if (result) {
          showToast(`模块「${entry.manifest.name}」安装成功`, "success");
          setScannedModules((prev) => prev.filter((m) => m.manifest.id !== entry.manifest.id));
          void refresh();
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setInstalling(false);
      }
    },
    [refresh, showToast],
  );

  if (!isTauriRuntime()) return null;

  return (
    <div id="module-manager" className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">第三方模块</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        安装和管理 MCP 模块（如 CAD 绘图助手、Text-to-CAD 等）。
        模块独立运行在各自的进程中，通过 MCP stdio 协议与本机服务通信。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="yt-btn-svc"
          disabled={installing}
          onClick={handleInstall}
        >
          {installing ? "安装中…" : "安装模块"}
        </button>
        <button
          type="button"
          className="yt-btn-svc"
          disabled={scanning}
          onClick={handleScan}
        >
          {scanning ? "扫描中…" : "扫描目录"}
        </button>
        <button type="button" className="yt-btn-svc" onClick={() => void refresh()}>
          刷新列表
        </button>
      </div>

      {/* 扫描结果 */}
      {scannedModules.length > 0 && (
        <div className="mt-4 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
          <p className="text-xs font-medium text-blue-300">
            发现 {scannedModules.length} 个可安装模块：
          </p>
          <div className="mt-2 space-y-2">
            {scannedModules.map((entry) => (
              <div
                key={entry.manifest.id}
                className="flex items-center justify-between rounded border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-2"
              >
                <div>
                  <span className="text-xs font-medium text-[var(--text-primary)]">
                    {entry.manifest.name}
                  </span>
                  <span className="ml-2 text-[10px] text-[var(--text-tertiary)]">
                    v{entry.manifest.version}
                  </span>
                  {entry.manifest.description && (
                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                      {entry.manifest.description.slice(0, 80)}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]" title={entry.sourceDir}>
                    {entry.sourceDir}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded bg-blue-500/20 px-2.5 py-1 text-[11px] text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
                  disabled={installing}
                  onClick={() => void handleInstallScanned(entry)}
                >
                  安装
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 已安装模块列表 */}
      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-[11px] text-[var(--text-tertiary)]">加载中…</p>
        ) : modules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-center">
            <p className="text-xs text-[var(--text-tertiary)]">
              暂未安装第三方模块
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              点击「安装模块」并选择包含 module.json 的模块目录
            </p>
          </div>
        ) : (
          modules.map((m) => (
            <ModuleCard key={m.manifest.id} info={m} onRefresh={refresh} />
          ))
        )}
      </div>
    </div>
  );
});
