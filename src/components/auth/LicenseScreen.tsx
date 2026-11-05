import { useCallback, useEffect, useRef, useState } from "react";
import { useAppLogo } from "../../hooks/useAppLogo";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { useLicenseStore } from "../../stores/licenseStore";
import { humanizeLicenseActivateError, normalizeLicensePaste } from "../../lib/license-bridge";

export function LicenseScreen() {
  const logoSrc = useAppLogo();
  const { fingerprint, expired, renewSoon, install } = useLicenseStore();
  const [licenseText, setLicenseText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const copyFingerprint = useCallback(async () => {
    if (!fingerprint) return;
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择下方指纹文本");
    }
  }, [fingerprint]);

  const handleActivate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const text = normalizeLicensePaste(licenseText);
      if (!text) {
        setError("请粘贴授权文件内容");
        return;
      }
      setLoading(true);
      try {
        await install(text);
      } catch (err) {
        const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        setError(humanizeLicenseActivateError(msg));
      } finally {
        setLoading(false);
      }
    },
    [install, licenseText],
  );

  return (
    <div className="auth-screen">
      <div className="auth-card max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="app-brand-logo-slot app-brand-logo-slot--auth">
            <img src={logoSrc} alt={PRODUCT_NAME} className="app-brand-logo-img select-none" draggable={false} width={88} height={88} />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            {expired ? "授权已到期" : "设备授权"}
          </h1>
          <p className="mt-1 text-center text-xs text-[var(--text-muted)]">
            {expired
              ? "请续费后粘贴新授权以继续使用"
              : renewSoon
                ? "授权即将到期，请尽快续费"
                : "本设备尚未激活，请联系管理员获取授权"}
          </p>
        </div>

        <div className="auth-panel mb-4">
          <p className="mb-2 text-xs text-[var(--text-tertiary)]">机器指纹（发送给管理员）</p>
          <code className="block max-h-24 overflow-y-auto break-all rounded-lg bg-[var(--bg-hover)] p-2 font-mono text-[10px] leading-relaxed text-[var(--text-secondary)]">
            {fingerprint || "—"}
          </code>
          <button
            type="button"
            onClick={copyFingerprint}
            disabled={!fingerprint}
            className="mt-2 text-xs font-medium text-[var(--brand-color)] hover:underline disabled:opacity-50"
          >
            {copied ? "已复制" : "复制指纹"}
          </button>
        </div>

        <form onSubmit={handleActivate} className="space-y-3">
          <div>
            <label htmlFor="license-text" className="mb-1 block text-xs text-[var(--text-tertiary)]">
              授权文件内容（license.dat JSON）
            </label>
            <textarea
              id="license-text"
              value={licenseText}
              onChange={(e) => setLicenseText(e.target.value)}
              placeholder='粘贴 {"fingerprint":"...","signature":"..."} 内容'
              rows={6}
              className="yt-input w-full resize-none px-3 py-2 font-mono text-xs"
              disabled={loading}
            />
          </div>

          {error && <div className="auth-error whitespace-pre-wrap">{error}</div>}

          <button type="submit" disabled={loading} className="yt-btn-primary w-full py-2.5 disabled:opacity-50">
            {loading ? "激活中…" : "激活设备"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LicenseScreen;
