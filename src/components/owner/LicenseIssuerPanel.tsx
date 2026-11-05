import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  fetchLicenseStatus,
  generateLicenseContent,
  isValidLicenseFingerprint,
} from "../../lib/license-bridge";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useUiStore } from "../../stores/uiStore";

export const LicenseIssuerPanel = memo(function LicenseIssuerPanel() {
  const showToast = useUiStore((s) => s.showToast);

  const [fingerprint, setFingerprint] = useState("");
  const [note, setNote] = useState("");
  const [validDays, setValidDays] = useState(30);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedFp, setCopiedFp] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const flashCopied = useCallback((which: "fp" | "json") => {
    if (which === "fp") {
      setCopiedFp(true);
    } else {
      setCopiedJson(true);
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopiedFp(false);
      setCopiedJson(false);
    }, 2000);
  }, []);

  const fillLocalFingerprint = useCallback(async () => {
    const status = await fetchLicenseStatus();
    if (!status?.fingerprint) {
      showToast("无法读取本机指纹", "error");
      return;
    }
    setFingerprint(status.fingerprint);
    showToast("已填入本机指纹", "info");
  }, [showToast]);

  const onGenerate = useCallback(async () => {
    const fp = fingerprint.trim().toLowerCase();
    if (!isValidLicenseFingerprint(fp)) {
      showToast("指纹应为 64 位十六进制", "error");
      return;
    }
    setBusy(true);
    try {
      const json = await generateLicenseContent(fp, note.trim() || undefined, validDays);
      if (!json) {
        showToast("生成失败，请先解锁 Owner", "error");
        return;
      }
      setOutput(json);
      showToast("授权内容已生成", "success");
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
      showToast(msg.slice(0, 200), "error");
    } finally {
      setBusy(false);
    }
  }, [fingerprint, note, showToast, validDays]);

  const copyText = useCallback(
    async (text: string, which: "fp" | "json") => {
      const t = text.trim();
      if (!t) return;
      try {
        await navigator.clipboard.writeText(t);
        flashCopied(which);
        showToast(which === "fp" ? "指纹已复制" : "授权 JSON 已复制", "success");
      } catch {
        showToast("复制失败", "error");
      }
    },
    [flashCopied, showToast],
  );

  if (!isTauriRuntime()) {
    return null;
  }

  return (
    <div
      id="license-issuer"
      className="rounded-xl border border-[color-mix(in_oklab,var(--brand-color)_35%,var(--border-subtle))] bg-[var(--surface-glass)] p-4"
    >
      <div className="font-medium text-[var(--text-primary)]">授权签发（开发 / 厂商）</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        根据客户机器指纹生成带到期时间的 <code className="text-[11px]">license.dat</code> JSON。默认有效期 30 天；到期后软件将停止使用。需 Owner 解锁；密钥来自安装目录{" "}
        <code className="text-[11px]">activation.secret</code>。命令行等效：
        <code className="mt-1 block text-[10px] text-[var(--text-muted)]">scripts\generate-license.ps1</code>
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="issuer-fingerprint" className="mb-1 block text-[11px] text-[var(--text-tertiary)]">
            目标机器指纹（64 位 hex）
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="issuer-fingerprint"
              value={fingerprint}
              onChange={(e) => setFingerprint(e.target.value)}
              placeholder="客户发来的指纹…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]"
              disabled={busy}
            />
            <button type="button" className="yt-btn-svc text-xs" disabled={busy} onClick={() => void fillLocalFingerprint()}>
              本机指纹
            </button>
            <button
              type="button"
              className="yt-btn-svc text-xs"
              disabled={!fingerprint.trim()}
              onClick={() => void copyText(fingerprint, "fp")}
            >
              {copiedFp ? "已复制" : "复制"}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="issuer-valid-days" className="mb-1 block text-[11px] text-[var(--text-tertiary)]">
            有效天数（到期后软件停止使用）
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {[7, 30, 90, 365].map((days) => (
              <button
                key={days}
                type="button"
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs",
                  validDays === days
                    ? "border-[var(--brand-color)] bg-[var(--brand-surface-select)] text-[var(--brand-color)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                ].join(" ")}
                disabled={busy}
                onClick={() => setValidDays(days)}
              >
                {days} 天
              </button>
            ))}
            <input
              id="issuer-valid-days"
              type="number"
              min={1}
              max={3650}
              value={validDays}
              onChange={(e) => setValidDays(Math.max(1, Number(e.target.value) || 30))}
              className="w-24 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
              disabled={busy}
            />
          </div>
        </div>

        <div>
          <label htmlFor="issuer-note" className="mb-1 block text-[11px] text-[var(--text-tertiary)]">
            备注（可选，写入 note 字段）
          </label>
          <input
            id="issuer-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="客户名、套餐、到期说明等"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
            disabled={busy}
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onGenerate()}
          className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "生成中…" : "生成授权 JSON"}
        </button>

        {output ? (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-[var(--text-tertiary)]">生成结果</span>
              <button
                type="button"
                className="text-xs font-medium text-[var(--brand-color)] hover:underline"
                onClick={() => void copyText(output, "json")}
              >
                {copiedJson ? "已复制" : "复制全部"}
              </button>
            </div>
            <textarea
              readOnly
              value={output}
              rows={8}
              className="yt-input w-full resize-none px-3 py-2 font-mono text-[11px]"
            />
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              将以上内容发给客户：在「设备授权」页粘贴，或保存为安装目录下的 license.dat。
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
});
