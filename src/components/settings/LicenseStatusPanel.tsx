import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  activateLicense,
  fetchLicenseStatus,
  formatLicenseExpiryLabel,
  humanizeLicenseActivateError,
  installLicenseAsOwner,
  normalizeLicensePaste,
  type LicenseStatus,
} from "../../lib/license-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useLicenseStore } from "../../stores/licenseStore";
import { useOwnerStore } from "../../stores/ownerStore";
import { useUiStore } from "../../stores/uiStore";

export const LicenseStatusPanel = memo(function LicenseStatusPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const ownerUnlocked = useOwnerStore((s) => s.unlocked || Boolean(s.devBypass));
  const setLicenseStore = useLicenseStore.setState;

  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [licenseText, setLicenseText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setStatus({ licensed: true, fingerprint: "", message: "浏览器预览模式" });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchLicenseStatus();
      if (next) {
        setStatus(next);
        setLicenseStore({
          licensed: next.licensed,
          fingerprint: next.fingerprint,
          message: next.message,
          expiresAt: next.expiresAt ?? null,
          expired: Boolean(next.expired),
          renewSoon: Boolean(next.renewSoon),
          daysRemaining: next.daysRemaining ?? null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [setLicenseStore]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const copyFingerprint = useCallback(async () => {
    const fp = status?.fingerprint?.trim();
    if (!fp) return;
    try {
      await navigator.clipboard.writeText(fp);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      showToast("指纹已复制", "success");
    } catch {
      showToast("复制失败，请手动选择指纹文本", "error");
    }
  }, [showToast, status?.fingerprint]);

  const onActivate = useCallback(async () => {
    const text = normalizeLicensePaste(licenseText);
    if (!text) {
      showToast("请粘贴授权 JSON", "error");
      return;
    }
    const canSelfRenew = !status?.licensed || Boolean(status?.renewSoon) || Boolean(status?.expired);
    setBusy(true);
    try {
      const next =
        status?.licensed && ownerUnlocked && !canSelfRenew
          ? await installLicenseAsOwner(text)
          : await activateLicense(text);
      if (!next) {
        throw new Error(ownerUnlocked ? "更换授权失败" : "激活失败");
      }
      if (!next.licensed) {
        throw new Error(next.message?.trim() || "授权未生效");
      }
      setStatus(next);
      setLicenseStore({
        licensed: next.licensed,
        fingerprint: next.fingerprint,
        message: next.message,
        expiresAt: next.expiresAt ?? null,
        expired: Boolean(next.expired),
        renewSoon: Boolean(next.renewSoon),
        daysRemaining: next.daysRemaining ?? null,
      });
      setLicenseText("");
      showToast(next.licensed ? "授权已更新" : "授权未生效", next.licensed ? "success" : "error");
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
      showToast(humanizeLicenseActivateError(msg).slice(0, 240), "error");
    } finally {
      setBusy(false);
    }
  }, [licenseText, ownerUnlocked, setLicenseStore, showToast, status?.expired, status?.licensed, status?.renewSoon]);

  if (!isTauriRuntime()) {
    return (
      <div
        id="license-status"
        className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4 text-xs text-[var(--text-secondary)]"
      >
        设备授权仅在桌面版可用。
      </div>
    );
  }

  return (
    <div
      id="license-status"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium text-[var(--text-primary)]">设备授权</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            授权与 CPU/主机名绑定。未授权时请复制指纹发给管理员；已授权可在此查看状态。
          </p>
        </div>
        <button type="button" className="yt-btn-svc text-xs" disabled={loading} onClick={() => void refresh()}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span
          className={
            status?.expired
              ? "rounded-full bg-[color-mix(in_oklab,var(--color-error)_14%,transparent)] px-2 py-0.5 font-medium text-[var(--color-error)]"
              : status?.renewSoon
                ? "rounded-full bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)] px-2 py-0.5 font-medium text-[var(--warn-text)]"
                : status?.licensed
                  ? "rounded-full bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] px-2 py-0.5 font-medium text-[var(--color-success)]"
                  : "rounded-full bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)] px-2 py-0.5 font-medium text-[var(--warn-text)]"
          }
        >
          {loading
            ? "检查中…"
            : status?.expired
              ? "已到期"
              : status?.renewSoon
                ? "即将到期"
                : status?.licensed
                  ? "已授权"
                  : "未授权"}
        </span>
        {status?.licensed && status.expiresAt ? (
          <span className="text-[11px] text-[var(--text-muted)]">
            有效期至 {formatLicenseExpiryLabel(status.expiresAt)}
            {status.daysRemaining != null ? `（约 ${status.daysRemaining} 天）` : ""}
          </span>
        ) : null}
      </div>

      {status?.renewSoon && status.licensed ? (
        <div className="mt-3 yt-warn-banner text-[11px] leading-relaxed">
          授权将在 3 天内到期，请将本机指纹发给管理员续费，并在下方粘贴新授权。
        </div>
      ) : null}

      {status?.message ? (
        <p className="mt-2 whitespace-pre-wrap text-[11px] text-[var(--text-muted)]">{status.message}</p>
      ) : null}

      <div className="mt-3">
        <p className="mb-1 text-[11px] text-[var(--text-tertiary)]">本机指纹</p>
        <code className="block max-h-20 overflow-y-auto break-all rounded-lg bg-[var(--bg-hover)] p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
          {status?.fingerprint || "—"}
        </code>
        <button
          type="button"
          onClick={() => void copyFingerprint()}
          disabled={!status?.fingerprint}
          className="mt-2 text-xs font-medium text-[var(--brand-color)] hover:underline disabled:opacity-50"
        >
          {copied ? "已复制" : "复制指纹"}
        </button>
      </div>

      {(!status?.licensed || status?.renewSoon || status?.expired || ownerUnlocked) && (
        <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <label htmlFor="license-status-paste" className="block text-[11px] text-[var(--text-tertiary)]">
            {status?.licensed && !status?.renewSoon && ownerUnlocked
              ? "更换授权（Owner）"
              : status?.renewSoon
                ? "续费：粘贴新授权 JSON"
                : "粘贴授权 JSON"}
          </label>
          <textarea
            id="license-status-paste"
            value={licenseText}
            onChange={(e) => setLicenseText(e.target.value)}
            placeholder='{"fingerprint":"...","signature":"..."}'
            rows={5}
            disabled={busy}
            className="yt-input w-full resize-none px-3 py-2 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onActivate()}
            className="yt-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {busy ? "处理中…" : status?.renewSoon ? "续费激活" : status?.licensed ? "更换授权" : "激活本机"}
          </button>
        </div>
      )}
    </div>
  );
});
