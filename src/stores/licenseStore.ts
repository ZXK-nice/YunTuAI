import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauriRuntime } from "../lib/tauri-env";
import { normalizeLicensePaste, type LicenseStatus } from "../lib/license-bridge";

type LicenseState = {
  licensed: boolean;
  fingerprint: string;
  message: string;
  expiresAt: string | null;
  expired: boolean;
  renewSoon: boolean;
  daysRemaining: number | null;
  isInitialized: boolean;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  install: (content: string) => Promise<void>;
};

function applyStatus(set: (partial: Partial<LicenseState>) => void, status: LicenseStatus) {
  set({
    licensed: status.licensed,
    fingerprint: status.fingerprint,
    message: status.message,
    expiresAt: status.expiresAt ?? null,
    expired: Boolean(status.expired),
    renewSoon: Boolean(status.renewSoon),
    daysRemaining: status.daysRemaining ?? null,
  });
}

export const useLicenseStore = create<LicenseState>((set) => ({
  licensed: false,
  fingerprint: "",
  message: "",
  expiresAt: null,
  expired: false,
  renewSoon: false,
  daysRemaining: null,
  isInitialized: false,

  initialize: async () => {
    if (!isTauriRuntime()) {
      set({
        licensed: true,
        isInitialized: true,
        message: "浏览器预览模式",
        expiresAt: null,
        expired: false,
        renewSoon: false,
        daysRemaining: null,
      });
      return;
    }
    try {
      const status = await invoke<LicenseStatus>("check_license");
      applyStatus(set, status);
      set({ isInitialized: true });
    } catch (err) {
      const msg = typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
      set({
        licensed: !import.meta.env.PROD,
        fingerprint: "",
        message: import.meta.env.PROD ? `无法验证授权：${msg.slice(0, 160)}` : msg,
        expiresAt: null,
        expired: false,
        renewSoon: false,
        daysRemaining: null,
        isInitialized: true,
      });
    }
  },

  refresh: async () => {
    if (!isTauriRuntime()) return;
    try {
      const status = await invoke<LicenseStatus>("check_license");
      applyStatus(set, status);
    } catch {
      /* 刷新失败保持原状态，避免误踢出 */
    }
  },

  install: async (content: string) => {
    const status = await invoke<LicenseStatus>("activate_license", {
      content: normalizeLicensePaste(content),
    });
    if (!status?.licensed) {
      throw new Error(status?.message?.trim() || "激活失败，请检查授权内容");
    }
    applyStatus(set, status);
  },
}));
