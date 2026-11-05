import { memo, useCallback, useEffect, useState } from "react";
import { checkForAppUpdate, consumeUpdateFailureHint, installMsiUpdate } from "../../lib/app-update";
import { APP_VERSION } from "../../lib/app-version";
import { isTauriRuntime } from "../../lib/tauri-env";
import { fetchSystemInfo } from "../../lib/system-info-bridge";
import {
  getUpdateAutoCheck,
  getUpdateManifestUrl,
  setUpdateAutoCheck,
  setUpdateManifestUrl,
  type UpdateCheckResult,
} from "../../lib/update-config";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

export const AppUpdatePanel = memo(function AppUpdatePanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [manifestUrl, setManifestUrlInput] = useState("");
  const [autoCheck, setAutoCheck] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [nonDefaultInstallDrive, setNonDefaultInstallDrive] = useState(false);

  useEffect(() => {
    setManifestUrlInput(getUpdateManifestUrl());
    setAutoCheck(getUpdateAutoCheck());
    if (!isTauriRuntime()) return;
    void fetchSystemInfo().then((info) => {
      const dir = info?.installDir?.trim() ?? "";
      const drive = dir.charAt(0).toUpperCase();
      setNonDefaultInstallDrive(Boolean(drive && drive !== "C" && dir.includes(":")));
    });
  }, []);

  const onCheck = useCallback(async () => {
    if (!isTauriRuntime()) {
      showToast("浏览器预览模式不支持检查更新", "info");
      return;
    }
    setUpdateManifestUrl(manifestUrl);
    setChecking(true);
    try {
      const r = await checkForAppUpdate(manifestUrl.trim());
      if (!r) return;
      setResult(r);
      if (r.errorHint) {
        showToast(r.errorHint.slice(0, 180), "error");
      } else if (r.available) {
        showToast(`发现新版本 ${r.latestVersion ?? ""}`, "info");
      } else {
        showToast(`当前已是最新版本（${APP_VERSION}）`, "info");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`检查更新失败：${msg.slice(0, 160)}`, "error");
    } finally {
      setChecking(false);
    }
  }, [manifestUrl, showToast]);

  const onInstall = useCallback(async () => {
    if (useSessionStore.getState().isSending) {
      showToast("请等待当前回复完成或点击停止后再更新", "error");
      return;
    }
    if (!result?.downloadUrl || !result.sha256) {
      showToast("缺少下载地址或校验值", "error");
      return;
    }
    setInstalling(true);
    try {
      showToast("正在下载更新包，应用即将退出并在后台完成安装（约 2～10 分钟，请保持网络畅通）…", "info");
      await installMsiUpdate({
        downloadUrl: result.downloadUrl,
        sha256: result.sha256,
        versionLabel: result.latestVersion,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`更新失败：${msg.slice(0, 160)}`, "error");
      setInstalling(false);
    }
  }, [result, showToast]);

  if (!isTauriRuntime()) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4 text-xs text-[var(--text-secondary)]">
        软件更新（MSI）仅在桌面版可用。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">软件更新（MSI）</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        通过远程 <code className="text-[11px]">latest.json</code> 检测新版本，下载 MSI 后后台覆盖安装（可见进度条，完成后会自动重新打开）。
        你的会话数据库与 <code className="text-[11px]">服务数据目录</code>会保留。
      </p>
      {nonDefaultInstallDrive ? (
        <p className="mt-2 yt-warn-banner text-[11px] leading-relaxed">
          检测到安装目录不在 C 盘。若应用内更新失败，请关闭本程序后，在安装目录运行{" "}
          <code className="text-[10px]">Install-YunTuAI.cmd</code>（或右键 MSI 以管理员身份安装）完成升级。
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        <label className="block text-[11px] text-[var(--text-tertiary)]">当前版本</label>
        <div className="text-sm font-medium text-[var(--text-primary)]">{APP_VERSION}</div>
      </div>

      <div className="mt-3 space-y-1">
        <label className="block text-[11px] text-[var(--text-tertiary)]" htmlFor="update-manifest-url">
          更新清单 URL（latest.json）
        </label>
        <input
          id="update-manifest-url"
          type="url"
          value={manifestUrl}
          onChange={(e) => setManifestUrlInput(e.target.value)}
          placeholder="https://你的域名/yuntuai/latest.json"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)]"
        />
      </div>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={autoCheck}
          onChange={(e) => {
            setAutoCheck(e.target.checked);
            setUpdateAutoCheck(e.target.checked);
          }}
          className="rounded border-[var(--border-subtle)]"
        />
        登录后自动检查更新
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={checking || installing}
          onClick={() => void onCheck()}
          className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {checking ? "检查中…" : "检查更新"}
        </button>
        {result?.available && result.downloadUrl && result.sha256 ? (
          <button
            type="button"
            disabled={installing || checking}
            onClick={() => void onInstall()}
            className="yt-btn-svc"
          >
            {installing ? "安装中…" : `安装 ${result.latestVersion ?? "新版本"}`}
          </button>
        ) : null}
      </div>

      {result && !result.errorHint ? (
        <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 text-[11px] text-[var(--text-secondary)]">
          {result.available ? (
            <>
              <div className="text-[var(--color-warn)]">
                可更新：{result.currentVersion} → {result.latestVersion}
              </div>
              {result.notes ? <div className="mt-1 whitespace-pre-wrap">{result.notes}</div> : null}
            </>
          ) : (
            <div>远程最新版本：{result.latestVersion ?? APP_VERSION}（无需更新）</div>
          )}
        </div>
      ) : null}

      {result?.errorHint ? (
        <p className="mt-2 text-[11px] text-[var(--color-error)]">{result.errorHint}</p>
      ) : null}
    </div>
  );
});

/** 启动时静默检查；有新版则 Toast 提示；若上次 MSI 失败则提示一次。 */
export async function runStartupUpdateCheck(showToast: (msg: string, kind: "info" | "error") => void): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const failHint = await consumeUpdateFailureHint();
    if (failHint) {
      showToast(
        `上次软件更新未完成：${failHint.slice(0, 120)}。可在「软件设置 → 软件更新」重试，或使用 Install-YunTuAI.cmd。`,
        "error",
      );
    }
  } catch {
    /* 静默 */
  }
  if (!getUpdateAutoCheck()) return;
  const url = getUpdateManifestUrl().trim();
  if (!url) return;
  try {
    const r = await checkForAppUpdate(url);
    if (r?.available && r.latestVersion) {
      showToast(`发现新版本 ${r.latestVersion}，可在「软件设置 → 软件更新」安装`, "info");
    }
  } catch {
    /* 静默：不打扰启动 */
  }
}
