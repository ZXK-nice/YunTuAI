import { memo, useCallback, useState } from "react";
import { useAuthPasswordPolicy } from "../../hooks/useAuthPasswordPolicy";
import { invokeAuthed } from "../../lib/tauri-invoke";
import { useUiStore } from "../../stores/uiStore";

export const AccountPasswordSection = memo(function AccountPasswordSection() {
  const showToast = useUiStore((s) => s.showToast);
  const { hint, validate, maxLength, inputMode } = useAuthPasswordPolicy();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const oldP = oldPassword.trim();
      const newP = newPassword.trim();
      const confirmP = confirmPassword.trim();
      if (!oldP || !newP) {
        setError("请填写完整");
        return;
      }
      if (newP !== confirmP) {
        setError("两次新密码不一致");
        return;
      }
      const pwErr = validate(newP);
      if (pwErr) {
        setError(pwErr);
        return;
      }
      setBusy(true);
      try {
        await invokeAuthed("auth_change_password", {
          oldPassword: oldP,
          newPassword: newP,
        });
        setOldPassword("");
        setNewPassword("");
        setConfirmPassword("");
        showToast("密码已修改", "success");
      } catch (err) {
        const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [confirmPassword, newPassword, oldPassword, showToast, validate],
  );

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">修改登录密码</div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">需验证当前密码；Owner 解锁后也可在用户管理中重置他人密码。</p>
      <form onSubmit={(e) => void onSubmit(e)} className="mt-3 space-y-2">
        <input
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          placeholder="当前密码"
          autoComplete="current-password"
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
          disabled={busy}
        />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder={`新密码（${hint}）`}
          autoComplete="new-password"
          maxLength={maxLength}
          inputMode={inputMode}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
          disabled={busy}
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="确认新密码"
          autoComplete="new-password"
          maxLength={maxLength}
          inputMode={inputMode}
          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
          disabled={busy}
        />
        {error ? <div className="text-xs text-[var(--color-error)]">{error}</div> : null}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-glass)] disabled:opacity-50"
        >
          {busy ? "保存中…" : "保存新密码"}
        </button>
      </form>
    </div>
  );
});
