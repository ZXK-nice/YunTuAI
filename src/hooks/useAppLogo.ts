import { appLogoForScheme } from "../lib/app-logo";
import { useUiStore } from "../stores/uiStore";

/** 随当前主题返回对应 Logo（浅→黑标，深→白标） */
export function useAppLogo(): string {
  const colorScheme = useUiStore((s) => s.colorScheme);
  return appLogoForScheme(colorScheme);
}
