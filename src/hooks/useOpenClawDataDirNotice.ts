import { useEffect } from "react";
import {
  dismissOpenClawDataDupNotice,
  fetchOpenClawDataRoots,
  openClawDataDupNoticeDismissed,
} from "../lib/openclaw/data-roots-bridge";
import { formatUserFacingPath } from "../lib/product-copy";
import { isTauriRuntime } from "../lib/tauri-env";
import { useUiStore } from "../stores/uiStore";

/** 检测到多套服务数据目录时提示用户当前活跃目录，避免技能/配置不一致。 */
export function useOpenClawDataDirNotice() {
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test") return;
    if (openClawDataDupNoticeDismissed()) return;

    void (async () => {
      const report = await fetchOpenClawDataRoots();
      if (!report?.hasDuplicates) return;

      const others = report.entries.filter((e) => !e.isActive && e.hasOpenClawJson);
      if (others.length === 0) return;

      const altLines = others
        .slice(0, 2)
        .map((e) => `${e.label}（${e.skillDirCount} 个技能目录）`)
        .join("；");
      showToast(
        `检测到多套服务数据。当前使用：${formatUserFacingPath(report.activePath)}。另有：${altLines}。请在「软件设置 → 本机服务」确认路径，避免技能不一致。`,
        "info",
      );
      dismissOpenClawDataDupNotice();
    })();
  }, [showToast]);
}
