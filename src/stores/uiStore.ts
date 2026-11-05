import { create } from "zustand";
import { applyColorSchemeWithTransition, persistColorScheme, readStoredColorScheme, type ColorScheme } from "../lib/theme";
import { sanitizeUserFacingCopy } from "../lib/product-copy";
import {
  applyHeaderNavModeCss,
  applySidebarWidthCss,
  type HeaderNavMode,
  persistChatCollapsed,
  persistHeaderNavMode,
  persistSidebarExpanded,
  readChatCollapsed,
  headerNavModeFromLevel,
  readHeaderNavMode,
  readSidebarExpanded,
} from "../lib/layout-prefs";
import type { ConsoleSectionId } from "../lib/openclaw/console-rpc";
import {
  readComposerDrafts,
  persistComposerDrafts,
  trimComposerDrafts,
} from "../lib/chat/composer-draft-prefs";
import type { ChatContextCard } from "../lib/chat/context-cards";
import type { NavKey } from "../types/app-nav";

let composerLineId = 0;
let chatContextId = 0;
let toastSeq = 0;

/**
 * 跨面板向对话输入框插入文案（如右侧「快捷提示」）。
 * ChatPanel 消费后自动清空。
 */
type ComposerLine = { id: number; text: string };

export type PendingChatContext = { id: number; text: string; cards: ChatContextCard[] };

export type ToastVariant = "success" | "error" | "info" | "warning";
export type ToastAction = { label: string; onClick: () => void };
export type ToastItem = { id: number; message: string; variant: ToastVariant; action?: ToastAction };

export type NavIntent =
  | { kind: "chat"; sessionId: string }
  | { kind: "compose-chat" }
  | { kind: "outputs" }
  | { kind: "view"; nav: NavKey }
  | { kind: "console"; section: ConsoleSectionId; sessionKey?: string }
  | { kind: "settings"; focus?: SettingsFocus };

export type ConsoleFocus = {
  section: ConsoleSectionId;
  sessionKey?: string;
};

export type SettingsFocus =
  | "modules"
  | "software"
  | "license"
  | "license-issuer"
  | "owner-unlock"
  | "kb-assistant"
  | "output-dir";

type UiState = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleColorScheme: () => void;
  pendingComposerLine: ComposerLine | null;
  /** 跨面板向对话输入框插入文案（如右侧「快捷提示」）。 */
  queueComposerLine: (text: string) => void;
  pendingChatContext: PendingChatContext | null;
  /** 结构化上下文卡片 + 文案，进入对话后展示卡片预览并可发送 */
  queueChatContext: (text: string, cards: ChatContextCard[]) => void;
  /** 底部轻提示（替代 window.alert 的成功/信息类反馈） */
  toast: ToastItem | null;
  showToast: (message: string, variant?: ToastVariant, action?: ToastAction) => void;
  dismissToast: () => void;
  /** 跨页草稿持久化，key 为 sessionId 或 "__new__" */
  composerDrafts: Record<string, string>;
  setComposerDraft: (sessionId: string, draft: string) => void;
  clearComposerDraft: (sessionId: string) => void;
  /** 侧栏「新对话」递增，供 ChatPanel 清空输入区本地状态 */
  composeResetTick: number;
  bumpComposeReset: () => void;
  /** 跨面板导航：聊天 / 高级控制台 / 软件设置 */
  navIntent: NavIntent | null;
  consoleFocus: ConsoleFocus | null;
  settingsFocus: SettingsFocus | null;
  requestNavToChat: (sessionId: string) => void;
  requestNavToComposeChat: () => void;
  requestNavToOutputs: () => void;
  requestNavToView: (nav: NavKey) => void;
  requestNavToConsole: (section: ConsoleSectionId, sessionKey?: string) => void;
  requestNavToSettings: (focus?: SettingsFocus) => void;
  clearNavIntent: () => void;
  consumeConsoleFocus: () => ConsoleFocus | null;
  consumeSettingsFocus: () => SettingsFocus | null;
  /** 递增计数，供输入区模型选择器展开 */
  modelSelectorOpenTick: number;
  requestOpenModelSelector: () => void;
  /** 递增计数，供 AppShell 展开右侧任务进度侧栏 */
  sidePanelOpenTick: number;
  requestOpenSidePanel: () => void;
  /** 左侧会话栏是否展开（默认折叠） */
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
  toggleSidebarExpanded: () => void;
  /** 对话消息区是否收起（保留输入框） */
  chatCollapsed: boolean;
  setChatCollapsed: (collapsed: boolean) => void;
  toggleChatCollapsed: () => void;
  /** 顶部工作区导航栏显示档位（默认折叠） */
  headerNavMode: HeaderNavMode;
  setHeaderNavMode: (mode: HeaderNavMode) => void;
  setHeaderNavLevel: (level: number) => void;
};

const TOAST_MS = 4000;

let toastTimer: number | undefined;

let sidePanelOpenTick = 0;
let modelSelectorOpenTick = 0;

export const useUiStore = create<UiState>((set, get) => ({
  colorScheme: readStoredColorScheme(),
  setColorScheme: (scheme) => {
    persistColorScheme(scheme);
    applyColorSchemeWithTransition(scheme);
    set({ colorScheme: scheme });
  },
  toggleColorScheme: () => {
    const next = get().colorScheme === "light" ? "dark" : "light";
    get().setColorScheme(next);
  },
  pendingComposerLine: null,
  queueComposerLine: (text) => {
    const t = text.trim();
    if (!t) return;
    composerLineId += 1;
    set({ pendingComposerLine: { id: composerLineId, text: t } });
  },
  pendingChatContext: null,
  queueChatContext: (text, cards) => {
    if (cards.length === 0 && !text.trim()) return;
    chatContextId += 1;
    set({
      pendingChatContext: { id: chatContextId, text: text.trim(), cards },
    });
  },
  toast: null,
  showToast: (message, variant = "info", action?) => {
    const t = sanitizeUserFacingCopy(message.trim());
    if (!t) return;
    toastSeq += 1;
    const id = toastSeq;
    if (toastTimer !== undefined) {
      window.clearTimeout(toastTimer);
      toastTimer = undefined;
    }
    set({ toast: { id, message: t, variant, action } });
    toastTimer = window.setTimeout(() => {
      toastTimer = undefined;
      if (get().toast?.id === id) set({ toast: null });
    }, TOAST_MS);
  },
  dismissToast: () => {
    if (toastTimer !== undefined) {
      window.clearTimeout(toastTimer);
      toastTimer = undefined;
    }
    set({ toast: null });
  },
  composerDrafts: readComposerDrafts(),
  composeResetTick: 0,
  bumpComposeReset: () => set((s) => ({ composeResetTick: s.composeResetTick + 1 })),
  setComposerDraft: (sessionId, draft) => {
    set((s) => {
      const merged = { ...s.composerDrafts, [sessionId]: draft };
      const next = trimComposerDrafts(merged);
      persistComposerDrafts(next);
      return { composerDrafts: next };
    });
  },
  clearComposerDraft: (sessionId) => {
    set((s) => {
      if (!(sessionId in s.composerDrafts)) return s;
      const next = { ...s.composerDrafts };
      delete next[sessionId];
      persistComposerDrafts(next);
      return { composerDrafts: next };
    });
  },
  navIntent: null,
  consoleFocus: null,
  settingsFocus: null,
  requestNavToChat: (sessionId) => {
    const id = sessionId.trim();
    if (!id) return;
    set({ navIntent: { kind: "chat", sessionId: id } });
  },
  requestNavToComposeChat: () => {
    set({ navIntent: { kind: "compose-chat" } });
  },
  requestNavToOutputs: () => {
    set({ navIntent: { kind: "outputs" } });
  },
  requestNavToView: (nav) => {
    set({ navIntent: { kind: "view", nav } });
  },
  requestNavToConsole: (section, sessionKey) => {
    const key = sessionKey?.trim();
    set({
      navIntent: { kind: "console", section, ...(key ? { sessionKey: key } : {}) },
      consoleFocus: { section, ...(key ? { sessionKey: key } : {}) },
    });
  },
  requestNavToSettings: (focus) => {
    set({
      navIntent: { kind: "settings", ...(focus ? { focus } : {}) },
      settingsFocus: focus ?? null,
    });
  },
  clearNavIntent: () => set({ navIntent: null }),
  consumeConsoleFocus: () => {
    const focus = get().consoleFocus;
    if (focus) set({ consoleFocus: null });
    return focus;
  },
  consumeSettingsFocus: () => {
    const focus = get().settingsFocus;
    if (focus) set({ settingsFocus: null });
    return focus;
  },
  sidePanelOpenTick: 0,
  requestOpenSidePanel: () => {
    sidePanelOpenTick += 1;
    set({ sidePanelOpenTick });
  },
  modelSelectorOpenTick: 0,
  requestOpenModelSelector: () => {
    modelSelectorOpenTick += 1;
    set({ modelSelectorOpenTick });
  },
  sidebarExpanded: readSidebarExpanded(),
  setSidebarExpanded: (expanded) => {
    persistSidebarExpanded(expanded);
    applySidebarWidthCss(expanded);
    set({ sidebarExpanded: expanded });
  },
  toggleSidebarExpanded: () => {
    const next = !get().sidebarExpanded;
    get().setSidebarExpanded(next);
  },
  chatCollapsed: readChatCollapsed(),
  setChatCollapsed: (collapsed) => {
    persistChatCollapsed(collapsed);
    set({ chatCollapsed: collapsed });
  },
  toggleChatCollapsed: () => {
    get().setChatCollapsed(!get().chatCollapsed);
  },
  headerNavMode: readHeaderNavMode(),
  setHeaderNavMode: (mode) => {
    persistHeaderNavMode(mode);
    applyHeaderNavModeCss(mode);
    set({ headerNavMode: mode });
  },
  setHeaderNavLevel: (level) => {
    get().setHeaderNavMode(headerNavModeFromLevel(level));
  },
}));
