import logoLight from "../assets/logo-light.png";
import logoDark from "../assets/logo-dark.png";
import type { ColorScheme } from "./theme";

/** 浅色主题用黑色 logo；深色主题用白色 logo */
export { logoLight, logoDark };

/** @deprecated 请使用 appLogoForScheme 或 useAppLogo */
export const logoMark = logoLight;

export function appLogoForScheme(scheme: ColorScheme): string {
  return scheme === "dark" ? logoDark : logoLight;
}

export default logoLight;
