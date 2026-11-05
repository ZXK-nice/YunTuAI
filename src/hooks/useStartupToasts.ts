import { useEffect, useRef, useState } from "react";
import {
  cliOpenClawControlDiscover,
  type OpenClawControlDiscovery,
} from "../lib/openclaw/cli-bridge";
import { resolveExclusiveStartupToast } from "../lib/openclaw/startup-toast-messages";
import { isInStartupGrace } from "../lib/openclaw/gateway-recovery";
import { getItem, setItem } from "../lib/safeStorage";
import { isTauriRuntime } from "../lib/tauri-env";
import { useGatewayStore } from "../stores/gatewayStore";
import { useLicenseStore } from "../stores/licenseStore";
import { useOwnerStore } from "../stores/ownerStore";
import { useUiStore } from "../stores/uiStore";
import { formatLicenseExpiryLabel } from "../lib/license-bridge";

const LEGACY_IMPORT_DISMISS_KEY = "yuntuai.legacyImportBannerDismissed";
const EXCLUSIVE_OK_TOAST_KEY = "yuntuai.exclusiveOkToastShown";

function licenseRenewToastKey(expiresAt: string) {
  return `yuntuai.licenseRenewToast.${expiresAt}`;
}

/** 启动时一次性弹出 网关 监管 / 迁移类提示（替代原常驻横幅）。 */
export function useStartupToasts() {
  const showToast = useUiStore((s) => s.showToast);
  const ownerUnlocked = useOwnerStore((s) => s.unlocked);
  const exclusiveReport = useGatewayStore((s) => s.exclusiveReport);
  const renewSoon = useLicenseStore((s) => s.renewSoon);
  const expiresAt = useLicenseStore((s) => s.expiresAt);
  const licensed = useLicenseStore((s) => s.licensed);

  const [discovery, setDiscovery] = useState<OpenClawControlDiscovery | null>(null);
  const [legacyDismissed] = useState(() => getItem(LEGACY_IMPORT_DISMISS_KEY) === "1");
  const legacyToastedRef = useRef(false);
  const exclusiveKeyRef = useRef<string | null>(null);
  const licenseRenewToastedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test") return;
    void cliOpenClawControlDiscover().then(setDiscovery);
  }, []);

  useEffect(() => {
    if (
      !discovery?.migrationRecommended ||
      !ownerUnlocked ||
      legacyDismissed ||
      legacyToastedRef.current
    ) {
      return;
    }
    legacyToastedRef.current = true;
    showToast("发现旧版用户目录中的训练数据，可在软件设置由 Owner 一键导入", "info");
    setItem(LEGACY_IMPORT_DISMISS_KEY, "1");
  }, [discovery, legacyDismissed, ownerUnlocked, showToast]);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test" || !exclusiveReport) return;

    const payload = resolveExclusiveStartupToast(exclusiveReport);
    if (!payload) return;

    // 启动宽限期内：孤儿网关回收尚未完成，暂不弹「未监管冲突」误报。
    if (
      payload.variant === "error" &&
      exclusiveReport.externalGatewayConflict &&
      isInStartupGrace()
    ) {
      return;
    }

    if (payload.key === "ok-running" && sessionStorage.getItem(EXCLUSIVE_OK_TOAST_KEY) === "1") {
      return;
    }

    if (exclusiveKeyRef.current === payload.key) return;
    exclusiveKeyRef.current = payload.key;

    if (payload.key === "ok-running") {
      sessionStorage.setItem(EXCLUSIVE_OK_TOAST_KEY, "1");
    }

    showToast(payload.message, payload.variant);
  }, [exclusiveReport, showToast]);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test" || !licensed || !renewSoon || !expiresAt) {
      return;
    }
    const key = licenseRenewToastKey(expiresAt);
    if (sessionStorage.getItem(key) === "1" || licenseRenewToastedRef.current === key) {
      return;
    }
    licenseRenewToastedRef.current = key;
    sessionStorage.setItem(key, "1");
    const label = formatLicenseExpiryLabel(expiresAt);
    showToast(
      label ? `设备授权将于 ${label} 到期，请提前续费（设置 → 设备授权）` : "设备授权即将到期，请提前续费",
      "info",
    );
  }, [expiresAt, licensed, renewSoon, showToast]);
}
