import { useEffect, useRef } from "react";
import { consumeUpgradeNotice } from "../lib/app-upgrade-bridge";
import { isTauriRuntime } from "../lib/tauri-env";
import { useUiStore } from "../stores/uiStore";

/** 覆盖升级后首次启动：温和提示 1.3.x → 1.4.0 变更，避免用户不适应。 */
export function useUpgradeWelcomeNotice() {
  const shownRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test") return;
    if (shownRef.current) return;

    void consumeUpgradeNotice().then((notice) => {
      if (!notice?.hints?.length || shownRef.current) return;
      shownRef.current = true;
      const title = notice.fromVersion
        ? `已升级到 v${notice.toVersion}（自 v${notice.fromVersion}）`
        : `已升级到 v${notice.toVersion}`;
      useUiStore.getState().showToast(title, "success");
      window.setTimeout(() => {
        for (const hint of notice.hints.slice(0, 3)) {
          useUiStore.getState().showToast(hint, "info");
        }
      }, 800);
    });
  }, []);
}
