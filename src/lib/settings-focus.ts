import type { SettingsFocus } from "../stores/uiStore";
import { settingsFocusToTab, type SettingsTab } from "./settings-nav";

export { settingsFocusToTab, type SettingsTab };

export function settingsFocusTargetId(focus: SettingsFocus): string | null {
  switch (focus) {
    case "modules":
      return "module-manager";
    case "kb-assistant":
      return "kb-assistant-settings";
    case "software":
      return "software-settings";
    case "output-dir":
      return "settings-output-dir";
    case "license":
      return "license-status";
    case "license-issuer":
      return "license-issuer";
    case "owner-unlock":
      return "owner-unlock";
    default:
      return null;
  }
}

/** 深链滚动到设置分区；成功滚动后调用 onComplete。 */
export function scrollToSettingsFocus(
  focus: SettingsFocus,
  ownerUnlocked: boolean,
  onComplete: () => void,
  options?: { onSwitchTab?: (tab: SettingsTab) => void },
): void {
  options?.onSwitchTab?.(settingsFocusToTab(focus));

  if (focus === "license-issuer" && !ownerUnlocked) {
    document.getElementById("owner-unlock")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const targetId = settingsFocusTargetId(focus);
  if (!targetId) {
    onComplete();
    return;
  }

  let attempts = 0;
  const tryScroll = () => {
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      onComplete();
      return;
    }
    attempts += 1;
    if (attempts < 12) {
      window.setTimeout(tryScroll, 100);
      return;
    }
    onComplete();
  };

  window.requestAnimationFrame(tryScroll);
}
