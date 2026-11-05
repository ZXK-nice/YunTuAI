import { useCallback, useEffect, useState } from "react";
import { useAuthPasswordPolicy } from "../../hooks/useAuthPasswordPolicy";
import { invokeAuthed } from "../../lib/tauri-invoke";
import { useOwnerStore } from "../../stores/ownerStore";
import { useAuthStore } from "../../stores/authStore";
import { useUiStore } from "../../stores/uiStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type UserRow = {
  id: string;
  username: string;
  role: string;
  createdAt: string;
};

export function OwnerUserManagement() {
  const unlocked = useOwnerStore((s) => s.unlocked);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const showToast = useUiStore((s) => s.showToast);
  const { validate, maxLength, inputMode, hint } = useAuthPasswordPolicy();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; username: string } | null>(null);

  const loadUsers = useCallback(async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      const rows = await invokeAuthed<UserRow[]>("auth_list_users");
      setUsers(rows ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, unlocked]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (!unlocked) return null;

  async function onResetPassword(userId: string) {
    const p = newPassword.trim();
    const pwErr = validate(p);
    if (pwErr) {
      showToast(pwErr, "error");
      return;
    }
    try {
      await invokeAuthed("auth_admin_reset_password", {
        targetUserId: userId,
        newPassword: p,
      });
      showToast("密码已重置", "success");
      setResetTarget(null);
      setNewPassword("");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function onSetRole(userId: string, role: string) {
    try {
      await invokeAuthed("auth_set_user_role", { targetUserId: userId, newRole: role });
      showToast("角色已更新", "success");
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  const executeDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { id, username } = deleteTarget;
    setDeleteTarget(null);
    try {
      await invokeAuthed("auth_delete_user", { targetUserId: id });
      showToast(`用户「${username}」已删除`, "success");
      await loadUsers();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [deleteTarget, loadUsers, showToast]);

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium text-[var(--text-primary)]">用户管理</div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Owner 解锁后可重置任意用户密码、调整角色或删除账户。
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void loadUsers()}
          className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs hover:bg-[var(--surface-glass)] disabled:opacity-50"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {users.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">暂无用户。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const resetting = resetTarget === u.id;
            return (
              <li
                key={u.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-black/10 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--text-primary)]">{u.username}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px]">{u.role}</span>
                  {isSelf ? (
                    <span className="text-[10px] text-[var(--text-muted)]">（当前登录）</span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {!isSelf && (
                    <>
                      <button
                        type="button"
                        className="rounded border border-[var(--border-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)]"
                        onClick={() => onSetRole(u.id, u.role === "admin" ? "user" : "admin")}
                      >
                        设为 {u.role === "admin" ? "user" : "admin"}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[var(--border-subtle)] px-2 py-1 hover:bg-[var(--bg-hover)]"
                        onClick={() => {
                          setResetTarget(resetting ? null : u.id);
                          setNewPassword("");
                        }}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className="rounded border border-[color-mix(in_oklab,var(--color-error)_30%,transparent)] px-2 py-1 text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_8%,transparent)]"
                        onClick={() => setDeleteTarget({ id: u.id, username: u.username })}
                      >
                        删除
                      </button>
                    </>
                  )}
                </div>
                {resetting && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-[12rem] flex-1">
                      <label className="mb-1 block text-[10px] text-[var(--text-secondary)]">
                        新密码（{hint}）
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs"
                        autoComplete="new-password"
                        maxLength={maxLength}
                        inputMode={inputMode}
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded bg-[var(--brand-color)] px-3 py-1.5 text-[11px] font-medium text-white"
                      onClick={() => void onResetPassword(u.id)}
                    >
                      确认重置
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除用户"
        titleId="oc-delete-user-title"
        variant="danger"
        confirmLabel="删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void executeDelete()}
      >
        <p>
          确定删除用户「<span className="font-medium text-[var(--text-primary)]">{deleteTarget?.username}</span>」？此操作不可撤销。
        </p>
      </ConfirmDialog>
    </div>
  );
}
