/**
 * i18n 骨架：当前产品默认 zh-CN，后续可扩展 en-US 等 locale。
 */
export type AppLocale = "zh-CN" | "en-US";

const DEFAULT_LOCALE: AppLocale = "zh-CN";

const MESSAGES: Record<AppLocale, Record<string, string>> = {
  "zh-CN": {
    "app.name": "云图 AI",
    "auth.login": "登录",
    "auth.desktop_only": "此功能需要在云图桌面客户端中使用",
    "error.generic": "操作失败，请重试",
  },
  "en-US": {
    "app.name": "YunTu AI",
    "auth.login": "Sign in",
    "auth.desktop_only": "This feature requires the YunTu desktop app",
    "error.generic": "Operation failed, please retry",
  },
};

let activeLocale: AppLocale = DEFAULT_LOCALE;

export function getLocale(): AppLocale {
  return activeLocale;
}

export function setLocale(locale: AppLocale): void {
  activeLocale = locale;
}

export function t(key: string, fallback?: string): string {
  return MESSAGES[activeLocale][key] ?? MESSAGES[DEFAULT_LOCALE][key] ?? fallback ?? key;
}
