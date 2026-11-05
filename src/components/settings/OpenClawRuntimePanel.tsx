import { memo, useCallback, useEffect, useState } from "react";
import { invokeAuthed } from "../../lib/tauri-invoke";
import { cliGatewaySupervisorRestart } from "../../lib/openclaw/cli-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { useUiStore } from "../../stores/uiStore";

const MEMORY_PRESETS = [
  { value: 256, label: "256 MB（最省内存）" },
  { value: 512, label: "512 MB（保守）" },
  { value: 1024, label: "1024 MB（推荐）" },
  { value: 1536, label: "1536 MB（标准）" },
  { value: 2048, label: "2048 MB（宽松）" },
  { value: 4096, label: "4096 MB（大型任务）" },
] as const;

/** 本机服务：仅网关内存上限（内置运行时，不与系统 PATH 外置安装混用）。 */
export const OpenClawRuntimePanel = memo(function OpenClawRuntimePanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [memoryMb, setMemoryMb] = useState<number | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);

  const refreshMemory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const mb = await invokeAuthed<number>("openclaw_gateway_memory_limit");
      setMemoryMb(mb);
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const t = setTimeout(() => void refreshMemory(), 80);
    return () => clearTimeout(t);
  }, [refreshMemory]);

  const handleMemoryChange = async (mb: number) => {
    if (memorySaving || mb === memoryMb) return;
    setMemorySaving(true);
    try {
      await invokeAuthed("openclaw_gateway_memory_limit_save", { mb });
      setMemoryMb(mb);
      showToast(`本机服务内存上限已设为 ${mb} MB，正在重启本机服务…`, "info");
      await cliGatewaySupervisorRestart().catch(() => null);
      showToast(`本机服务内存上限已设为 ${mb} MB`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setMemorySaving(false);
    }
  };

  if (!isTauriRuntime()) return null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">本机服务内存上限</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        限制 {PRODUCT_NAME} 内置本机服务进程的内存上限。降低后可减少低配机占用；修改后请重启本机服务或重连。
      </p>
      <div className="mt-3">
        {memoryMb != null ? (
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--focus-ring)]"
              value={memoryMb}
              onChange={(e) => void handleMemoryChange(Number(e.target.value))}
              disabled={memorySaving}
              aria-label="本机服务内存上限"
            >
              {MEMORY_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {memorySaving ? (
              <span className="text-[10px] text-[var(--text-tertiary)]">保存中…</span>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-[var(--text-tertiary)]">加载中…</span>
        )}
      </div>
    </div>
  );
});
