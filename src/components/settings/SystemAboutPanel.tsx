import { memo, useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "../../lib/app-version";
import { formatUserFacingPath } from "../../lib/product-copy";
import { fetchSystemInfo, type SystemInfoReport } from "../../lib/system-info-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

/** 用户手册「关于本机与系统信息 / 系统信息面板」。 */
export const SystemAboutPanel = memo(function SystemAboutPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [info, setInfo] = useState<SystemInfoReport | null>(null);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setInfo(await fetchSystemInfo());
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [showToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const copyFingerprint = async () => {
    const fp = info?.fingerprint?.trim();
    if (!fp) return;
    try {
      await navigator.clipboard.writeText(fp);
      setCopied(true);
      showToast("指纹已复制", "success");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("复制失败，请手动选择指纹文本", "error");
    }
  };

  if (!isTauriRuntime()) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4 text-xs text-[var(--text-secondary)]">
        系统信息仅在桌面版可用。当前版本 {APP_VERSION}。
      </div>
    );
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: "软件版本", value: info?.appVersion ?? APP_VERSION },
    { label: "操作系统", value: info ? `${info.os} (${info.arch})` : "—" },
    { label: "安装目录", value: formatUserFacingPath(info?.installDir) },
    { label: "数据目录", value: formatUserFacingPath(info?.dataDir) },
    { label: "服务数据目录", value: formatUserFacingPath(info?.openclawDataDir) },
    {
      label: "WebView2",
      value: info ? (info.webview2Installed ? "已安装" : "未检测到") : "—",
    },
  ];

  return (
    <div
      id="settings-about"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="font-medium text-[var(--text-primary)]">关于本机与系统信息</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        安装路径、数据目录与设备指纹；排障时可截图本页或复制指纹发给管理员。
      </p>
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-0.5">
            <dt className="text-[11px] text-[var(--text-tertiary)]">{row.label}</dt>
            <dd className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{row.value}</dd>
          </div>
        ))}
      </dl>
      {info?.fingerprint ? (
        <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3">
          <p className="text-[11px] text-[var(--text-tertiary)]">机器指纹</p>
          <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
            {info.fingerprint}
          </p>
          <button
            type="button"
            onClick={() => void copyFingerprint()}
            className="mt-2 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-glass)]"
          >
            {copied ? "已复制" : "复制指纹"}
          </button>
        </div>
      ) : null}
    </div>
  );
});
