const SIDEBAR_KEY = "yuntu.sidebarExpanded";
const CHAT_COLLAPSED_KEY = "yuntu.chatCollapsed";
const HEADER_NAV_MODE_KEY = "yuntu.headerNavMode";

/** 顶部工作区导航栏显示档位：折叠 / 标准 / 展开 */
export type HeaderNavMode = "collapsed" | "normal" | "expanded";

export const HEADER_NAV_MODES: readonly HeaderNavMode[] = ["collapsed", "normal", "expanded"] as const;

export const HEADER_NAV_MODE_LABELS: Record<HeaderNavMode, string> = {
  collapsed: "折叠",
  normal: "折叠（标准字号）",
  expanded: "展开",
};

export const SIDEBAR_WIDTH_EXPANDED = "16rem";
export const SIDEBAR_WIDTH_COLLAPSED = "3.5rem";

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** 默认折叠侧栏，给主工作区更多空间 */
export function readSidebarExpanded(): boolean {
  return readBool(SIDEBAR_KEY, false);
}

export function persistSidebarExpanded(expanded: boolean): void {
  writeBool(SIDEBAR_KEY, expanded);
}

export function readChatCollapsed(): boolean {
  return readBool(CHAT_COLLAPSED_KEY, false);
}

export function persistChatCollapsed(collapsed: boolean): void {
  writeBool(CHAT_COLLAPSED_KEY, collapsed);
}

export function applySidebarWidthCss(expanded: boolean): void {
  document.documentElement.style.setProperty(
    "--sidebar-width",
    expanded ? SIDEBAR_WIDTH_EXPANDED : SIDEBAR_WIDTH_COLLAPSED,
  );
}

function parseHeaderNavMode(raw: string | null): HeaderNavMode | null {
  if (raw === "collapsed" || raw === "normal" || raw === "expanded") return raw;
  return null;
}

/** 默认折叠顶栏标签区，给对话区更多垂直空间 */
export function readHeaderNavMode(): HeaderNavMode {
  try {
    const v = localStorage.getItem(HEADER_NAV_MODE_KEY);
    return parseHeaderNavMode(v) ?? "collapsed";
  } catch {
    return "collapsed";
  }
}

export function persistHeaderNavMode(mode: HeaderNavMode): void {
  try {
    localStorage.setItem(HEADER_NAV_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function headerNavModeToLevel(mode: HeaderNavMode): number {
  const idx = HEADER_NAV_MODES.indexOf(mode);
  return idx >= 0 ? idx : 0;
}

export function headerNavModeFromLevel(level: number): HeaderNavMode {
  const idx = Math.min(HEADER_NAV_MODES.length - 1, Math.max(0, Math.round(level)));
  return HEADER_NAV_MODES[idx] ?? "collapsed";
}

export function applyHeaderNavModeCss(mode: HeaderNavMode): void {
  document.documentElement.dataset.headerNav = mode;
}
