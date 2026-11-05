export type ColorScheme = "light" | "dark";

const STORAGE_KEY = "yuntuai-color-scheme";
/** 主题过渡持续时间（与 CSS 中的 0.28s 一致） */
const THEME_FLIP_MS = 300;

/** 首屏 inline script 与 index.css `--bg-app` 须保持同色；改此处请同步 index.html */
export const THEME_APP_BG: Record<ColorScheme, string> = {
  light: "#fafafa",
  dark: "#0a0a0a",
};

type HtmlThemeFlip = HTMLElement & { __themeFlipTid?: number };

function faviconHref(scheme: ColorScheme): string {
  return scheme === "dark" ? "/logo-dark.png" : "/logo-light.png";
}

function syncThemeDom(scheme: ColorScheme): void {
  const html = document.documentElement;
  html.dataset.theme = scheme;
  html.style.colorScheme = scheme;
  html.style.background = THEME_APP_BG[scheme];
  const favicon = document.getElementById("app-favicon");
  if (favicon) {
    favicon.setAttribute("href", faviconHref(scheme));
  }
}

export function readStoredColorScheme(): ColorScheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* ignore */
  }
  return "light";
}

export function persistColorScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}

export function applyColorScheme(scheme: ColorScheme): void {
  syncThemeDom(scheme);
}

/** 带平滑过渡的主题切换 */
export function applyColorSchemeWithTransition(scheme: ColorScheme): void {
  const html = document.documentElement as HtmlThemeFlip;
  if (html.__themeFlipTid != null) {
    window.clearTimeout(html.__themeFlipTid);
    html.__themeFlipTid = undefined;
  }

  html.classList.add("theme-flip");
  syncThemeDom(scheme);

  html.__themeFlipTid = window.setTimeout(() => {
    html.classList.remove("theme-flip");
    html.__themeFlipTid = undefined;
  }, THEME_FLIP_MS);
}
