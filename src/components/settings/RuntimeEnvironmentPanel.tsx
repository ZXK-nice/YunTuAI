import { memo, useCallback, useEffect, useState } from "react";
import { fetchSystemInfo, type RuntimeCheckItem, type SystemInfoReport } from "../../lib/system-info-bridge";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

/** 用户手册「运行环境检测界面」：本机组件与权限自检。 */
export const RuntimeEnvironmentPanel = memo(function RuntimeEnvironmentPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [info, setInfo] = useState<SystemInfoReport | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setLoading(true);
    try {
      const next = await fetchSystemInfo();
      setInfo(next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!isTauriRuntime()) return null;

  return (
    <div
      id="settings-env"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-[var(--text-primary)]">运行环境与硬件提示</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            首次启动前可在此确认 WebView2、内置服务组件与 OCR 是否就绪。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          disabled={loading}
          className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
        >
          {loading ? "检测中…" : "重新检测"}
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {(info?.runtimeChecks ?? []).map((item) => (
          <CheckRow key={item.id} item={item} />
        ))}
        {!info && !loading ? (
          <p className="text-xs text-[var(--text-tertiary)]">无法读取运行环境信息。</p>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        推荐配置：x86_64 四核、8GB 内存、10GB 可用磁盘。低配机可在下方将本机服务内存上限设为 512～1024 MB。
      </p>
    </div>
  );
});

function CheckRow({ item }: { item: RuntimeCheckItem }) {
  return (
    <div className="flex gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 px-3 py-2">
      <span
        className={`mt-0.5 text-xs font-semibold ${item.ok ? "text-emerald-400" : "text-amber-300"}`}
        aria-hidden
      >
        {item.ok ? "✓" : "!"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--text-primary)]">{item.label}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          {sanitizeUserFacingCopy(item.detail)}
        </p>
      </div>
    </div>
  );
}
