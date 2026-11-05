import { invoke } from "@tauri-apps/api/core";
import { invokeWithAuthRetry } from "../lib/auth-token";
import { create } from "zustand";
import { isFrontendDevOwnerBypass } from "../lib/owner-dev";
import { getAuthToken } from "./authStore";
import { isTauriRuntime } from "../lib/tauri-env";

export type OwnerSessionStatus = {
  unlocked: boolean;
  expiresAtMs: number | null;
  devBypass?: boolean;
};

type OwnerState = OwnerSessionStatus & {
  isInitialized: boolean;
  refresh: () => Promise<void>;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
};

const lockedState: Pick<OwnerState, "unlocked" | "expiresAtMs" | "isInitialized" | "devBypass"> = {
  unlocked: false,
  expiresAtMs: null,
  isInitialized: false,
  devBypass: false,
};

function applyDevBypassState(): Pick<OwnerState, "unlocked" | "expiresAtMs" | "isInitialized" | "devBypass"> {
  return {
    unlocked: true,
    expiresAtMs: null,
    isInitialized: true,
    devBypass: true,
  };
}

export const useOwnerStore = create<OwnerState>((set, get) => ({
  ...lockedState,

  refresh: async () => {
    if (!isTauriRuntime()) {
      set(isFrontendDevOwnerBypass() ? applyDevBypassState() : { ...lockedState, isInitialized: true });
      return;
    }
    const token = getAuthToken();
    if (!token) {
      set({ ...lockedState, isInitialized: true });
      return;
    }
    try {
      const status = await invokeWithAuthRetry<OwnerSessionStatus>("owner_session_status_cmd", {}, {
        critical: false,
      });
      set({
        unlocked: status.unlocked,
        expiresAtMs: status.expiresAtMs ?? null,
        devBypass: status.devBypass ?? false,
        isInitialized: true,
      });
    } catch {
      set({ ...lockedState, isInitialized: true });
    }
  },

  login: async (password) => {
    if (!isTauriRuntime()) throw new Error("非 Tauri 环境");
    const token = getAuthToken();
    if (!token) throw new Error("请先登录用户账户");
    const status = await invoke<OwnerSessionStatus>("owner_login", { token, password });
    set({
      unlocked: status.unlocked,
      expiresAtMs: status.expiresAtMs ?? null,
      devBypass: status.devBypass ?? false,
      isInitialized: true,
    });
  },

  logout: async () => {
    if (get().devBypass) {
      return;
    }
    if (!isTauriRuntime()) {
      get().reset();
      return;
    }
    const token = getAuthToken();
    if (token) {
      try {
        const status = await invoke<OwnerSessionStatus>("owner_logout", { token });
        set({
          unlocked: status.unlocked,
          expiresAtMs: status.expiresAtMs ?? null,
          devBypass: status.devBypass ?? false,
          isInitialized: true,
        });
        return;
      } catch {
        /* fall through */
      }
    }
    get().reset();
  },

  reset: () => {
    set({ ...lockedState, isInitialized: true });
  },
}));

export function isOwnerUnlocked(): boolean {
  const s = useOwnerStore.getState();
  return s.unlocked || Boolean(s.devBypass);
}
