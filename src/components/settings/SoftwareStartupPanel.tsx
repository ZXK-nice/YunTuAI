import { memo, useCallback, useEffect, useState } from "react";
import {
  fetchAutostartEnabled,
  fetchLaunchContext,
  setAutostartEnabled,
} from "../../lib/app-launch-bridge";
import {
  persistAutoContinueIncomplete,
  readAutoContinueIncomplete,
} from "../../lib/chat/auto-continue-prefs";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

export const SoftwareStartupPanel = memo(function SoftwareStartupPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [legacyStartupBat, setLegacyStartupBat] = useState(false);
  const [autoContinue, setAutoContinue] = useState(true);

  useEffect(() => {
    setAutoContinue(readAutoContinueIncomplete());
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    void Promise.all([fetchAutostartEnabled(), fetchLaunchContext()])
      .then(([autostart, ctx]) => {
        setEnabled(autostart);
        setLegacyStartupBat(Boolean(ctx?.legacyStartupBat));
      })
      .finally(() => setLoading(false));
  }, []);

  const onToggle = useCallback(async () => {
    if (!isTauriRuntime() || busy) return;
    const next = !enabled;
    setBusy(true);
    try {
      await setAutostartEnabled(next);
      setEnabled(next);
      showToast(
        next
          ? "已开启开机自启动：登录 Windows 后将在后台运行，托盘左键可打开主界面"
          : "已关闭开机自启动",
        "success",
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [busy, enabled, showToast]);

  if (!isTauriRuntime()) return null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">启动与托盘</div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        关闭主窗口时会最小化到系统托盘，不会退出程序。开机自启默认关闭；开启后登录系统时在后台启动本机服务，不弹出主界面。
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-color)]"
          checked={enabled}
          disabled={loading || busy}
          onChange={() => void onToggle()}
        />
        <span className="text-sm text-[var(--text-primary)]">
          开机自动启动（后台运行，不显示主窗口）
        </span>
      </label>
      <label className="mt-3 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-color)]"
          checked={autoContinue}
          onChange={() => {
            const next = !autoContinue;
            persistAutoContinueIncomplete(next);
            setAutoContinue(next);
            showToast(
              next
                ? "已开启自动续跑：仅规划或工具截断时最多续两次"
                : "已关闭自动续跑",
              "success",
            );
          }}
        />
        <span className="text-sm text-[var(--text-primary)]">
          任务未完整交付时自动续跑（仅规划 / 工具截断，最多 2 次）
        </span>
      </label>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        托盘图标左键单击显示主界面；右键菜单中「退出 YunTuAI」可彻底退出程序。
      </p>
      {import.meta.env.DEV ? (
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          当前为开发版，请勿在此开启开机自启。开发版依赖本机 Vite（localhost:1420），开机后未启动开发服务器会出现「localhost 拒绝连接」。
        </p>
      ) : null}
      {legacyStartupBat ? (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          检测到 Windows「启动」文件夹中的旧版 <code className="font-mono">YunTuAI-AutoStart.bat</code>
          。请删除该文件，仅保留上方勾选的开机自启，避免重复启动或弹出空白页。
        </p>
      ) : null}
    </div>
  );
});
