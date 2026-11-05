import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppLogo } from "../../hooks/useAppLogo";
import { APP_VERSION } from "../../lib/app-version";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../../lib/product-brand";
import { fetchDistributionProfile } from "../../lib/openclaw/env-bridge";
import { DIRECT_PASSWORD_HINT, validateLoginPassword } from "../../lib/auth-password-policy";
import { useAuthStore } from "../../stores/authStore";
import { useOwnerStore } from "../../stores/ownerStore";
import { isTauriRuntime } from "../../lib/tauri-env";
import { setEncryptedItem, getEncryptedItem, removeItem } from "../../lib/safeStorage";

const REMEMBER_USERNAME_KEY = "yuntuai_remember_username";
const REMEMBER_EXPIRES_KEY = "yuntuai_remember_expires";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function saveRememberedUsername(username: string) {
  setEncryptedItem(REMEMBER_USERNAME_KEY, username.trim());
  setEncryptedItem(REMEMBER_EXPIRES_KEY, String(Date.now() + SEVEN_DAYS_MS));
}

function loadRememberedUsername(): string | null {
  const expiryRaw = getEncryptedItem(REMEMBER_EXPIRES_KEY);
  let raw = getEncryptedItem(REMEMBER_USERNAME_KEY);
  if (!raw) {
    const legacy = getEncryptedItem("yuntuai_remember_creds");
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as { username?: string };
        if (parsed.username) raw = parsed.username;
      } catch {
        /* ignore */
      }
    }
  }
  if (!raw || !expiryRaw) return null;
  const expiry = parseInt(expiryRaw, 10);
  if (isNaN(expiry) || Date.now() > expiry) {
    removeItem(REMEMBER_USERNAME_KEY);
    removeItem(REMEMBER_EXPIRES_KEY);
    removeItem("yuntuai_remember_creds");
    return null;
  }
  return raw.trim() || null;
}

function clearRememberedUsername() {
  removeItem(REMEMBER_USERNAME_KEY);
  removeItem(REMEMBER_EXPIRES_KEY);
  removeItem("yuntuai_remember_creds");
}

export function LoginScreen() {
  const logoSrc = useAppLogo();
  const {
    hasAnyUsers,
    accountDataLost,
    registrationAllowed,
    recoveryUsernames,
    isInitialized,
    initError,
    login,
    register,
    ownerEmergencyLogin,
  } = useAuthStore();
  const [isRegistering, setIsRegistering] = useState(false);
  const [ownerRecovery, setOwnerRecovery] = useState(false);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(true);
  const [openRegistration, setOpenRegistration] = useState(false);
  const [ownerEmergencyAvailable, setOwnerEmergencyAvailable] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState<{ score: number; label: string }>({ score: 0, label: "" });

  useEffect(() => {
    if (!isTauriRuntime() || !isInitialized || (!hasAnyUsers && !accountDataLost)) {
      setOwnerEmergencyAvailable(false);
      return;
    }
    void invoke<boolean>("owner_emergency_login_enabled_cmd")
      .then((v) => setOwnerEmergencyAvailable(Boolean(v)))
      .catch(() => setOwnerEmergencyAvailable(false));
  }, [hasAnyUsers, isInitialized, accountDataLost]);

  useEffect(() => {
    void fetchDistributionProfile().then((p) => {
      if (p?.openRegistration) setOpenRegistration(true);
    });
  }, []);

  // 启动时尝试填充记住的凭据
  useEffect(() => {
    if (isInitialized) {
      const remembered = loadRememberedUsername();
      if (remembered) {
        setUsername(remembered);
        setRememberPassword(true);
      } else {
        setRememberPassword(false);
      }
    }
  }, [isInitialized]);

  useEffect(() => {
    if (!isRegistering || !password) {
      setPasswordStrength({ score: 0, label: "" });
      return;
    }
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Za-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    const labels = ["", "弱", "一般", "较强"];
    setPasswordStrength({ score, label: labels[score] ?? "较强" });
  }, [isRegistering, password, openRegistration]);

  useEffect(() => {
    if (isInitialized && !hasAnyUsers && registrationAllowed && !accountDataLost) {
      setIsRegistering(true);
    }
  }, [isInitialized, hasAnyUsers, registrationAllowed, accountDataLost]);

  useEffect(() => {
    if (accountDataLost) {
      setOwnerRecovery(true);
      setIsRegistering(false);
      setUsername((u) => u.trim() || "admin");
    }
  }, [accountDataLost]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      const u = username.trim();
      const p = password.trim();
      const ownerP = ownerPassword.trim();
      if (!u) {
        setError("请输入用户名");
        return;
      }
      if (u.length < 2) {
        setError("用户名至少需要 2 个字符");
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(u)) {
        setError("用户名仅允许英文字母、数字、下划线和短横线");
        return;
      }
      if (ownerRecovery) {
        if (!ownerP) {
          setError("请输入 Owner 密码");
          return;
        }
        setLoading(true);
        try {
          await ownerEmergencyLogin(u, ownerP);
          await useOwnerStore.getState().refresh();
          setOwnerPassword("");
          setOwnerRecovery(false);
        } catch (err) {
          const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
          setError(msg);
        } finally {
          setLoading(false);
        }
        return;
      }
      if (!p) {
        setError("请输入密码");
        return;
      }
      if (isRegistering) {
        const pwErr = validateLoginPassword(p, openRegistration);
        if (pwErr) {
          setError(pwErr);
          return;
        }
        if (p !== confirmPassword.trim()) {
          setError("两次密码不一致");
          return;
        }
      }
      setLoading(true);
      try {
        if (isRegistering) {
          await register(u, p);
        } else {
          await login(u, p);
        }
        // 登录/注册成功后，处理记住密码
        if (!isRegistering && rememberPassword) {
          saveRememberedUsername(u);
        } else if (!isRegistering) {
          clearRememberedUsername();
        } else {
          clearRememberedUsername();
        }
      } catch (err) {
        const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [username, password, confirmPassword, isRegistering, login, register, rememberPassword, ownerRecovery, ownerPassword, ownerEmergencyLogin, openRegistration],
  );

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="mb-8 flex flex-col items-center">
          <div className="app-brand-logo-slot app-brand-logo-slot--auth">
            <img src={logoSrc} alt={PRODUCT_NAME} className="app-brand-logo-img select-none" draggable={false} width={88} height={88} />
          </div>
          <h1 className="text-2xl font-bold tracking-wide text-[var(--text-primary)]">{PRODUCT_NAME}</h1>
          <p className="mt-1 text-center text-xs text-[var(--text-muted)]">{PRODUCT_TAGLINE}</p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">v{APP_VERSION}</p>
        </div>

        {initError && <div className="auth-error mb-4">认证服务不可用：{initError}</div>}
        {accountDataLost && (
          <div className="auth-error mb-4">
            升级或迁移后，本机用户库暂时为空，不是软件损坏。请用下方「Owner 代为登录」重建管理员（用户名建议
            admin）。
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-username" className="mb-1 block text-xs text-[var(--text-tertiary)]">
              用户名
            </label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={ownerRecovery ? "已注册账号名（不是 Owner）" : "请输入用户名"}
              className="yt-input w-full px-3 py-2 text-sm"
              maxLength={64}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="login-password" className="mb-1 block text-xs text-[var(--text-tertiary)]">
              {ownerRecovery ? "用户密码（可留空）" : "密码"}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete={isRegistering ? "new-password" : ownerRecovery ? "off" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={ownerRecovery ? "Owner 代登无需用户密码" : "请输入密码"}
              className="yt-input w-full px-3 py-2 text-sm disabled:opacity-60"
              maxLength={128}
              disabled={loading || ownerRecovery}
            />
            {isRegistering && (
              <div className="mt-1 space-y-1">
                <p className="text-xs text-[var(--text-muted)]">
                  {DIRECT_PASSWORD_HINT}
                  {passwordStrength.score > 0 && (
                    <span
                      className={[
                        "ml-1 font-medium",
                        passwordStrength.score <= 1
                          ? "text-[var(--color-error)]"
                          : passwordStrength.score === 2
                            ? "text-[var(--color-warn)]"
                            : "text-[var(--color-success)]",
                      ].join(" ")}
                    >
                      · {passwordStrength.label}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>

          {ownerRecovery && (
            <div>
              <label htmlFor="login-owner-password" className="mb-1 block text-xs text-[var(--text-tertiary)]">
                Owner 密码
              </label>
              <input
                id="login-owner-password"
                type="password"
                autoComplete="off"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="请输入 Owner 密码以代为登录"
                className="yt-input w-full px-3 py-2 text-sm"
                maxLength={128}
                disabled={loading}
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
                {accountDataLost
                  ? "用户库为空时：填写要恢复的管理员用户名（建议 admin）+ Owner 密码，将重建该账户并登录。"
                  : recoveryUsernames.length === 1
                    ? `用户忘记密码时使用：本机账号为「${recoveryUsernames[0]}」（填错用户名也会自动代登）；Owner 密码为发版时配置的运维密码。`
                    : recoveryUsernames.length > 1
                      ? `用户忘记密码时使用：本机账号为 ${recoveryUsernames.map((n) => `「${n}」`).join("、")}；Owner 密码为发版时配置的运维密码。`
                      : "用户忘记密码时使用：用户名填已注册账号（不是 Owner）；Owner 密码为发版时配置的运维密码。"}
              </p>
            </div>
          )}

          {isRegistering && (
            <div>
              <label htmlFor="login-confirm-password" className="mb-1 block text-xs text-[var(--text-tertiary)]">
                确认密码
              </label>
              <input
                id="login-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                className="yt-input w-full px-3 py-2 text-sm"
                maxLength={128}
                disabled={loading}
              />
            </div>
          )}

          {!isRegistering && !ownerRecovery && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--separator)] bg-transparent text-[var(--brand-color)] focus:ring-[var(--brand-color)] cursor-pointer"
              />
              <span className="text-xs text-[var(--text-tertiary)]">
                记住用户名（7 天内自动填写）
              </span>
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading} className="yt-btn-primary w-full py-2.5 disabled:opacity-50">
            {loading
              ? ownerRecovery
                ? "Owner 代登中…"
                : isRegistering
                  ? "注册中…"
                  : "登录中…"
              : ownerRecovery
                ? "Owner 代为登录"
                : isRegistering
                  ? "注册并登录"
                  : "登 录"}
          </button>
        </form>

        {!isRegistering && (hasAnyUsers || accountDataLost) && (ownerEmergencyAvailable || accountDataLost) && (
          <p className="mt-4 text-center text-xs text-[var(--text-tertiary)]">
            {ownerRecovery ? (
              <>
                想起密码了？
                <button
                  type="button"
                  className="ml-1 text-[var(--brand-color)] hover:underline"
                  onClick={() => {
                    setOwnerRecovery(false);
                    setOwnerPassword("");
                    setError("");
                  }}
                >
                  返回普通登录
                </button>
              </>
            ) : (
              <>
                忘记密码？
                <button
                  type="button"
                  className="ml-1 text-[var(--brand-color)] hover:underline"
                  onClick={() => {
                    setOwnerRecovery(true);
                    setError("");
                    setPassword("");
                  }}
                >
                  Owner 代为登录
                </button>
              </>
            )}
          </p>
        )}

        {(registrationAllowed || (!hasAnyUsers && !accountDataLost)) && (
          <p className="mt-6 text-center text-xs text-[var(--text-tertiary)]">
            {isRegistering ? (
              hasAnyUsers ? (
                <>
                  已有账号？
                  <button
                    type="button"
                    className="ml-1 text-[var(--brand-color)] hover:underline"
                    onClick={() => {
                      setIsRegistering(false);
                      setError("");
                    }}
                  >
                    去登录
                  </button>
                </>
              ) : (
                <>首次使用，请创建管理员账户</>
              )
            ) : (
              <>
                没有账号？
                <button
                  type="button"
                  className="ml-1 text-[var(--brand-color)] hover:underline"
                  onClick={() => {
                    setIsRegistering(true);
                    setError("");
                  }}
                >
                  注册新用户
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export default LoginScreen;