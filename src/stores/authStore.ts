import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauriRuntime } from "../lib/tauri-env";
import { setEncryptedItem, getEncryptedItem, removeItem } from "../lib/safeStorage";
import { resetFirstRunClientState } from "../lib/first-run-gateway";
import { withTimeout } from "../lib/async-utils";

export type UserInfo = {
  id: string;
  username: string;
  role?: string;
  createdAt: string;
  token: string;
};

export type AuthGateStatus = {
  hasUsers: boolean;
  installSealed: boolean;
  registrationAllowed: boolean;
  accountDataLost: boolean;
  recoveryUsernames?: string[];
};

type AuthState = {
  user: UserInfo | null;
  isLoggedIn: boolean;
  hasAnyUsers: boolean;
  accountDataLost: boolean;
  registrationAllowed: boolean;
  recoveryUsernames: string[];
  isInitialized: boolean;
  initError: string | null;
  initialize: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  ownerEmergencyLogin: (username: string, ownerPassword: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const TOKEN_KEY = "yuntuai_auth_token";
let authInitPromise: Promise<void> | null = null;
const AUTH_INIT_TIMEOUT_MS = 8_000;
const DEV_AUTH_AUTO_LOGIN_TIMEOUT_MS = 25_000;
const DEV_AUTH_AUTO_LOGIN_ATTEMPTS = 8;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoggedIn: false,
  hasAnyUsers: false,
  accountDataLost: false,
  registrationAllowed: false,
  recoveryUsernames: [],
  isInitialized: false,
  initError: null,

  initialize: async () => {
    if (get().isInitialized) return;
    if (authInitPromise) return authInitPromise;

    authInitPromise = (async () => {
      if (!isTauriRuntime()) {
        set({ isInitialized: true, initError: null });
        return;
      }

      try {
        const devSkip = await withTimeout(
          invoke<boolean>("auth_dev_skip_login"),
          AUTH_INIT_TIMEOUT_MS,
          "auth_dev_skip_login",
        ).catch(() => false);
        if (devSkip) {
          let lastErr = "";
          for (let attempt = 0; attempt < DEV_AUTH_AUTO_LOGIN_ATTEMPTS; attempt += 1) {
            try {
              const user = await withTimeout(
                invoke<UserInfo>("auth_dev_auto_login"),
                DEV_AUTH_AUTO_LOGIN_TIMEOUT_MS,
                "auth_dev_auto_login",
              );
              setEncryptedItem(TOKEN_KEY, user.token);
              set({
                user,
                isLoggedIn: true,
                hasAnyUsers: true,
                registrationAllowed: false,
                accountDataLost: false,
                initError: null,
                isInitialized: true,
              });
              return;
            } catch (err) {
              lastErr =
                typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
              if (attempt < DEV_AUTH_AUTO_LOGIN_ATTEMPTS - 1) {
                await sleepMs(800 * (attempt + 1));
              }
            }
          }
          set({
            isInitialized: true,
            isLoggedIn: false,
            hasAnyUsers: false,
            accountDataLost: false,
            registrationAllowed: false,
            initError:
              `开发版自动登录失败：${lastErr || "未知错误"}。请完全退出后重跑 npm run tauri dev；` +
              "仍失败可手动登录 dev / devlocal。",
          });
          return;
        }

        const gate = await withTimeout(
          invoke<AuthGateStatus>("auth_gate_status"),
          AUTH_INIT_TIMEOUT_MS,
          "auth_gate_status",
        );
        if (!gate.hasUsers && !gate.installSealed) {
          resetFirstRunClientState();
        }
        const hasUsers = Boolean(gate.hasUsers || gate.installSealed);
        set({
          hasAnyUsers: hasUsers,
          accountDataLost: Boolean(gate.accountDataLost),
          registrationAllowed: Boolean(gate.registrationAllowed),
          recoveryUsernames: Array.isArray(gate.recoveryUsernames) ? gate.recoveryUsernames : [],
          initError: null,
        });

        if (gate.accountDataLost) {
          removeItem(TOKEN_KEY);
          set({ isInitialized: true, isLoggedIn: false, user: null });
          return;
        }

        if (!hasUsers) {
          set({ isInitialized: true });
          return;
        }

        const savedToken = getEncryptedItem(TOKEN_KEY);
        if (savedToken) {
          try {
            const user = await withTimeout(
              invoke<UserInfo>("auth_resume_session", { token: savedToken }),
              AUTH_INIT_TIMEOUT_MS,
              "auth_resume_session",
            );
            setEncryptedItem(TOKEN_KEY, user.token);
            set({ user, isLoggedIn: true, isInitialized: true });
            return;
          } catch {
            removeItem(TOKEN_KEY);
          }
        }

        set({ isInitialized: true });
      } catch (err) {
        const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
        set({
          isInitialized: true,
          hasAnyUsers: false,
          accountDataLost: false,
          registrationAllowed: false,
          initError: msg || "认证服务初始化失败",
        });
      }
    })();

    return authInitPromise;
  },

  login: async (username, password) => {
    if (!isTauriRuntime()) throw new Error("非 Tauri 环境");
    const user = await invoke<UserInfo>("auth_login", { username, password });
    setEncryptedItem(TOKEN_KEY, user.token);
    set({ user, isLoggedIn: true, hasAnyUsers: true, initError: null });
  },

  ownerEmergencyLogin: async (username, ownerPassword) => {
    if (!isTauriRuntime()) throw new Error("非 Tauri 环境");
    const user = await invoke<UserInfo>("auth_owner_emergency_login", {
      username,
      ownerPassword,
    });
    setEncryptedItem(TOKEN_KEY, user.token);
    set({ user, isLoggedIn: true, hasAnyUsers: true, initError: null });
  },

  register: async (username, password) => {
    if (!isTauriRuntime()) throw new Error("非 Tauri 环境");
    const user = await invoke<UserInfo>("auth_register", { username, password });
    setEncryptedItem(TOKEN_KEY, user.token);
    set({ user, isLoggedIn: true, hasAnyUsers: true, initError: null });
  },

  logout: async () => {
    const token = get().user?.token;
    if (token && isTauriRuntime()) {
      try {
        await invoke("auth_logout", { token });
      } catch {
        /* 忽略 */
      }
    }
    removeItem(TOKEN_KEY);
    set({ user: null, isLoggedIn: false });
  },
}));

/** 持久化会话 token（加密后），供后端 RPC 鉴权 */
export function getAuthToken(): string | null {
  return useAuthStore.getState().user?.token ?? null;
}