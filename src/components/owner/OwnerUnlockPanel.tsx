import { useCallback, useState } from "react";
import { useOwnerStore } from "../../stores/ownerStore";
import { useUiStore } from "../../stores/uiStore";

type Props = {
  /** 嵌入设置页时为 true，减少外边距 */
  compact?: boolean;
  onUnlocked?: () => void;
};

function formatExpiry(expiresAtMs: number | null): string {
  if (expiresAtMs == null) return "";
  const left = expiresAtMs - Date.now();
  if (left <= 0) return "已过期";
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  if (h > 0) return `约 ${h} 小时 ${m} 分钟后过期`;
  return `约 ${m} 分钟后过期`;
}

export function OwnerUnlockPanel({ compact, onUnlocked }: Props) {
  const unlocked = useOwnerStore((s) => s.unlocked);
  const devBypass = useOwnerStore((s) => s.devBypass);
  const expiresAtMs = useOwnerStore((s) => s.expiresAtMs);
  const login = useOwnerStore((s) => s.login);
  const logout = useOwnerStore((s) => s.logout);
  const showToast = useUiStore((s) => s.showToast);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const p = password.trim();
      if (!p) {
        setError("请输入 Owner 密码");
        return;
      }
      setBusy(true);
      try {
        await login(p);
        setPassword("");
        showToast("Owner 已解锁，开发权限已开放", "success");
        onUnlocked?.();
      } catch (err) {
        const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [login, onUnlocked, password, showToast],
  );

  const onLock = useCallback(async () => {
    setBusy(true);
    try {
      await logout();
      setPassword("");
      showToast("已锁定开发权限", "info");
    } finally {
      setBusy(false);
    }
  }, [logout, showToast]);

  return (
    <div
      id="owner-unlock"
      className={[
        "rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)]",
        compact ? "p-4" : "p-5",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-[var(--text-primary)]">Owner 开发权限</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            解锁后可管理用户账户、修改连接 Token、服务配置接管与数据迁移等深度运维能力。
          </p>
        </div>
        {unlocked ? (
          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-200">
            {devBypass ? "开发模式" : "已解锁"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[var(--warn-border)] bg-[var(--warn-surface)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--warn-text)]">
            已锁定
          </span>
        )}
      </div>

      {unlocked && devBypass ? (
        <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
          当前为开发构建（debug），Owner 限制已自动跳过；正式 release 安装包仍会要求密码。
        </p>
      ) : null}

      {unlocked && !devBypass ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[var(--text-secondary)]">{formatExpiry(expiresAtMs)}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onLock()}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            锁定
          </button>
        </div>
      ) : !unlocked ? (
        <form onSubmit={(e) => void onSubmit(e)} className="mt-3 space-y-2">
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor="owner-password">
            Owner 密码
          </label>
          <input
            id="owner-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入厂商 Owner 密码"
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={busy}
          />
          {error ? <div className="text-xs text-[var(--color-error)]">{error}</div> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--brand-color)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "验证中…" : "解锁开发权限"}
          </button>
        </form>
      ) : null}    </div>
  );
}
