import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "../../stores/agentStore";
import { releaseConnectPipelineUiPhase } from "../../lib/connect-with-feedback";
import { requestDesktopConnect } from "../../lib/openclaw/desktop-connect-scheduler";
import { getLaunchConnectProfile } from "../../lib/openclaw/launch-connect-profile";
import {
  chatGetOutputDir,
} from "../../lib/chat/chat-files-bridge";
import { useChatSendHandler } from "./useChatSendHandler";
import { ChatEmptyIcon, QuickStartIcon } from "./ChatQuickStartIcons";
import { useChatPendingAttachments, useComposerHeightSync } from "./useChatPendingAttachments";
import { useChatVoiceInput } from "./useChatVoiceInput";
import {
  persistLocalOnlyMode,
  readLocalOnlyMode,
  shouldSuggestLocalOnly,
} from "../../lib/chat/composer-execution-prefs";
import {
  isInterruptedAssistantContent,
  type ChatContextCard,
} from "../../lib/chat/context-cards";
import { isGenericSendAbortBanner } from "../../lib/chat/send-abort-ux";
import { isAttachmentExtractBlockingSend } from "../../lib/chat/attachment-preview";
import { isConnectSlowHint } from "../../lib/license-bridge";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useStepStore } from "../../stores/stepStore";
import { useUiStore } from "../../stores/uiStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ChatEmptyHeroMotion } from "../motion/ChatEmptyHeroMotion";
import { ComposerDockMotion } from "../motion/ComposerDockMotion";
import { ChatComposerBar } from "./ChatComposerBar";
import { ChatContextCardStrip } from "./ChatContextCardView";
import { ChatMessageList } from "./ChatMessageList";
import { ChatMessageSkeleton } from "../ui/Skeleton";
import { ChatStreamingBubble } from "./ChatStreamingBubble";
import { humanizeConnectError } from "../../lib/openclaw/connect-error-copy";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { prefersReducedMotion } from "../../lib/gsap/setup";
import { compactActiveSessionForUi } from "../../hooks/useConnectionDiagnostics";
import {
  contextPressureBannerText,
  estimateSessionTokens,
  isContextPressure,
} from "../../lib/openclaw/context-limit-policy";
import { collapseTurnAssistantMessages } from "../../lib/openclaw/collapse-turn-assistant-messages";
import {
  TASK_TEMPLATE_GROUP_SIZE,
  TASK_TEMPLATES,
  buildTaskTemplatePrompt,
  type TaskTemplate,
} from "../../lib/openclaw/task-templates";

const HERO_EXIT_MS = 320;
const QUICK_START_GROUPS = Math.ceil(TASK_TEMPLATES.length / TASK_TEMPLATE_GROUP_SIZE);
const EMPTY_ARR: never[] = [];

export const ChatPanel = memo(function ChatPanel() {
  const activeId = useSessionStore((s) => s.activeId);
  const active = useSessionStore((s) => (s.activeId ? s.sessions.find((x) => x.id === s.activeId) ?? null : null));
  const rawMessages = useSessionStore((s) => (activeId ? (s.messagesBySession[activeId] ?? EMPTY_ARR) : EMPTY_ARR));
  const messages = useMemo(
    () => (rawMessages.length > 1 ? collapseTurnAssistantMessages(rawMessages) : rawMessages),
    [rawMessages],
  );
  const hasMoreMessages = useSessionStore((s) => (activeId ? s.hasMoreBySession[activeId] : false));
  const loadingOlderMessages = useSessionStore((s) =>
    activeId ? Boolean(s.loadingOlderBySession[activeId]) : false,
  );
  const loadOlderMessages = useSessionStore((s) => s.loadOlderMessages);
  const isLoadingMessages = useSessionStore((s) =>
    s.activeId ? Boolean(s.loadingMessagesBySession[s.activeId]) : false,
  );
  const connSlice = useGatewayStore(
    useShallow((s) => ({
      connState: s.connState,
      lastError: s.lastError,
      startupPhase: s.startupPhase,
    })),
  );
  const { connState, lastError, startupPhase } = connSlice;
  const createSession = useSessionStore((s) => s.createSession);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const abortActiveSend = useSessionStore((s) => s.abortActiveSend);
  const sendProgressLabel = useSessionStore((s) => s.sendProgressLabel);
  const deleteMessage = useSessionStore((s) => s.deleteMessage);
  const { anyStepRunning, showPipelineBusy } = useStepStore(
    useShallow((s) => ({
      anyStepRunning: s.steps.some((st) => st.status === "running" || st.status === "pending"),
      showPipelineBusy: s.steps.some((st) => st.status === "running"),
    })),
  );
  const isSending = useSessionStore((s) => s.isSending);
  const sendingSessionId = useSessionStore((s) => s.sendingSessionId);
  const queuedSendPending = useSessionStore((s) => s.queuedSendPending);
  const lastRetryableSend = useSessionStore((s) => s.lastRetryableSend);
  const retryLastSend = useSessionStore((s) => s.retryLastSend);
  const dismissRetryableSend = useSessionStore((s) => s.dismissRetryableSend);
  const summarizeAndContinueInNewChat = useSessionStore((s) => s.summarizeAndContinueInNewChat);
  const busy = (isSending || queuedSendPending) && sendingSessionId === activeId;
  const agents = useAgentStore((s) => s.agents);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const activeAgent = useMemo(
    () => (activeAgentId ? agents.find((a) => a.id === activeAgentId) ?? null : null),
    [agents, activeAgentId],
  );
  const showToast = useUiStore((s) => s.showToast);
  const chatCollapsed = useUiStore((s) => s.chatCollapsed);
  const toggleChatCollapsed = useUiStore((s) => s.toggleChatCollapsed);
  const draftKey = activeId ?? "__new__";
  const hasRemoteSession = Boolean(active?.remoteSessionKey?.trim());
  const persistedDraft = useUiStore((s) => s.composerDrafts[draftKey] ?? "");
  const setComposerDraft = useUiStore((s) => s.setComposerDraft);
  const pendingComposerLine = useUiStore((s) => s.pendingComposerLine);
  const pendingChatContext = useUiStore((s) => s.pendingChatContext);
  const composeResetTick = useUiStore((s) => s.composeResetTick);

  const [draft, setDraft] = useState("");
  const [pendingContextCards, setPendingContextCards] = useState<ChatContextCard[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  /** 输入框是否已沉底（发送首条消息后 true；新对话 compose 模式 false） */
  const [composerDocked, setComposerDocked] = useState(false);
  const [heroExiting, setHeroExiting] = useState(false);
  const [composerDockAnimKey, setComposerDockAnimKey] = useState(0);
  const [connBannerVisible, setConnBannerVisible] = useState(false);
  const heroExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const loadOlderLockRef = useRef(false);
  const [showScrollChip, setShowScrollChip] = useState(false);
  const [localOnlyMode, setLocalOnlyMode] = useState(() => readLocalOnlyMode());

  const toggleLocalOnlyMode = useCallback(() => {
    setLocalOnlyMode((prev) => {
      const next = !prev;
      persistLocalOnlyMode(next);
      return next;
    });
  }, []);

  const localOnlySuggest = useMemo(
    () => !localOnlyMode && shouldSuggestLocalOnly(draft),
    [draft, localOnlyMode],
  );

  useEffect(() => {
    return () => {
      if (heroExitTimerRef.current) clearTimeout(heroExitTimerRef.current);
    };
  }, []);

  /** 有历史消息的会话：输入框始终在底部 */
  useEffect(() => {
    if (messages.length > 0) {
      setComposerDocked(true);
      setHeroExiting(false);
      if (heroExitTimerRef.current) {
        clearTimeout(heroExitTimerRef.current);
        heroExitTimerRef.current = null;
      }
    }
  }, [activeId, messages.length]);

  // Connection state banner
  useEffect(() => {
    if (connState === "connected") {
      setConnBannerVisible(false);
    } else if (connState === "disconnected" || connState === "error") {
      setConnBannerVisible(true);
    } else if (connState === "connecting" && startupPhase) {
      setConnBannerVisible(true);
    }
  }, [connState, startupPhase]);

  /** 侧栏「新对话」进入 compose 模式：输入框回中 */
  useEffect(() => {
    if (!activeId && messages.length === 0 && !busy && !anyStepRunning) {
      setComposerDocked(false);
      setHeroExiting(false);
      if (heroExitTimerRef.current) {
        clearTimeout(heroExitTimerRef.current);
        heroExitTimerRef.current = null;
      }
    }
  }, [activeId, messages.length, busy, anyStepRunning]);

  const dockComposerWithMotion = useCallback(() => {
    setComposerDocked((wasDocked) => {
      if (!wasDocked) setComposerDockAnimKey((k) => k + 1);
      return true;
    });
    setHeroExiting(true);
    if (heroExitTimerRef.current) clearTimeout(heroExitTimerRef.current);
    const ms = prefersReducedMotion() ? 0 : HERO_EXIT_MS;
    heroExitTimerRef.current = setTimeout(() => {
      setHeroExiting(false);
      heroExitTimerRef.current = null;
    }, ms);
  }, []);

  const canDraft = !activeId || !!active;
  const composerDisabled = !canDraft;
  const composerDisabledReason = composerDisabled ? "输入框暂不可用" : undefined;
  const canAttachFiles = !activeId || !!active;

  const {
    pendingAttachments,
    setPendingAttachments,
    dragOverComposer,
    fileInputRef,
    removePendingAttachment,
    onAttachClick,
    onFileInputChange,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onChatPaste,
  } = useChatPendingAttachments({
    canAttachFiles,
    showToast,
    composeResetTick,
  });

  const sendBlockedReason = useMemo(() => {
    if (pendingAttachments.some((a) => isAttachmentExtractBlockingSend(a.extractStatus))) {
      return "正在识别附件，请稍候再发送";
    }
    if (isSending && sendingSessionId && sendingSessionId !== activeId) {
      return "另一会话正在生成回复，请稍候";
    }
    if (queuedSendPending && sendingSessionId && sendingSessionId !== activeId) {
      return "另一会话正在排队等待连接";
    }
    return undefined;
  }, [pendingAttachments, isSending, sendingSessionId, activeId, queuedSendPending]);
  const sendDisabled = !!sendBlockedReason || composerDisabled;

  const {
    voiceListening,
    voiceChecking,
    voiceInterim,
    toggleVoiceInput,
  } = useChatVoiceInput({
    composerDisabled,
    showToast,
    setDraft,
  });

  useComposerHeightSync({
    draft,
    pendingAttachmentCount: pendingAttachments.length,
    composerDisabled,
    draftRef,
    listRef,
  });

  const sessionBusy = useMemo(() => busy || anyStepRunning, [busy, anyStepRunning]);
  const showInterruptedContinue = useMemo(() => {
    if (busy) return false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) break;
      const role = m.role.trim().toLowerCase();
      if (role === "user" || role === "human") break;
      if ((role === "assistant" || role === "model") && isInterruptedAssistantContent(m.content)) {
        return true;
      }
    }
    return false;
  }, [messages, busy, isSending]);
  const approxTokens = useMemo(() => estimateSessionTokens(messages), [messages]);
  const contextPressure = isContextPressure(approxTokens);
  const requestOpenModelSelector = useUiStore((s) => s.requestOpenModelSelector);
  const [compactingContext, setCompactingContext] = useState(false);
  const [summarizingHandoff, setSummarizingHandoff] = useState(false);

  /** 滚动到底帮助函数：用 scrollHeight 而非 offsetTop，避免 offsetParent 坐标系干扰。 */
  const scrollToListEnd = useCallback((smooth = false) => {
    const container = listRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, []);

  /** 切换会话时强制滚到底 */
  useEffect(() => {
    shouldAutoScroll.current = true;
    setShowScrollChip(false);
    const raf = requestAnimationFrame(() => {
      scrollToListEnd();
      requestAnimationFrame(() => scrollToListEnd());
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId, scrollToListEnd]);

  /** 消息加载或变化时如果 shouldAutoScroll 为 true 则滚到底 */
  useEffect(() => {
    if (!shouldAutoScroll.current) return;
    scrollToListEnd();
  }, [messages.length, scrollToListEnd]);

  /** 流式内容变化时滚到底（requestAnimationFrame 合并，每帧最多滚一次） */
  const onStreamContentChange = useCallback(() => {
    if (!shouldAutoScroll.current) return;
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      scrollToListEnd();
    });
  }, [scrollToListEnd]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  const handleDeleteMessage = useCallback((messageId: string) => {
    setDeleteTargetId(messageId);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const container = listRef.current;
    if (!container) return;
    shouldAutoScroll.current = true;
    setShowScrollChip(false);
    container.scrollTo({ top: container.scrollHeight, behavior: smooth ? "smooth" : "instant" });
  }, []);

  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = dist < 40;
    shouldAutoScroll.current = nearBottom;
    setShowScrollChip(!nearBottom && (messages.length > 0 || busy));

    if (
      activeId &&
      hasMoreMessages &&
      !loadingOlderMessages &&
      !loadOlderLockRef.current &&
      el.scrollTop < 80
    ) {
      loadOlderLockRef.current = true;
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      void loadOlderMessages(activeId).finally(() => {
        requestAnimationFrame(() => {
          const nextEl = listRef.current;
          if (nextEl) {
            nextEl.scrollTop = nextEl.scrollHeight - prevHeight + prevTop;
          }
          loadOlderLockRef.current = false;
        });
      });
    }
  }, [messages.length, busy, activeId, hasMoreMessages, loadingOlderMessages, loadOlderMessages]);

  useEffect(() => {
    if (!pendingComposerLine) return;
    setDraft((d) => (d ? `${d}\n\n${pendingComposerLine.text}` : pendingComposerLine.text));
    useUiStore.setState({ pendingComposerLine: null });
  }, [pendingComposerLine]);

  useEffect(() => {
    if (!pendingChatContext) return;
    if (pendingChatContext.text) {
      setDraft((d) => (d ? `${d}\n\n${pendingChatContext.text}` : pendingChatContext.text));
    }
    if (pendingChatContext.cards.length > 0) {
      setPendingContextCards((prev) => [...prev, ...pendingChatContext.cards]);
    }
    useUiStore.setState({ pendingChatContext: null });
    dockComposerWithMotion();
  }, [pendingChatContext, dockComposerWithMotion]);

  // Sync draft to uiStore for cross-page persistence (debounced)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setComposerDraft(draftKey, draft);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, draftKey, setComposerDraft]);

  // 侧栏「新对话」：清空输入框与上下文卡片（附件由 useChatPendingAttachments 监听 composeResetTick）
  useEffect(() => {
    setDraft("");
    setPendingContextCards([]);
    if (draftRef.current) draftRef.current.style.height = "auto";
  }, [composeResetTick]);

  // Restore draft when switching sessions
  useEffect(() => {
    setDraft(persistedDraft);
  }, [draftKey, persistedDraft]);

  const { onSend } = useChatSendHandler({
    active,
    activeAgentId,
    busy,
    connState,
    draft,
    pendingAttachments,
    pendingContextCards,
    localOnlyMode,
    setDraft,
    setPendingContextCards,
    setPendingAttachments,
    draftRef,
    dockComposerWithMotion,
    createSession,
  });

  const onPrimaryComposerAction = useCallback(() => {
    if (busy) {
      abortActiveSend();
    } else {
      void onSend();
    }
  }, [busy, onSend, abortActiveSend]);

  const onQuickStart = useCallback(
    async (template: TaskTemplate) => {
      if (busy) return;
      if (connState !== "connected") {
        showToast("请先连接本机服务", "error");
        return;
      }
      dockComposerWithMotion();
      if (!active) {
        await createSession(activeAgentId ?? undefined);
      }
      setDraft("");
      const outDir = (await chatGetOutputDir()) ?? "";
      const prompt = buildTaskTemplatePrompt(template, { outputDir: outDir });
      try {
        await sendMessage(prompt, {
          templateId: template.id,
          taskTitle: template.goal,
          localOnlyMode,
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [active?.id, busy, sendMessage, createSession, activeAgentId, connState, showToast, dockComposerWithMotion, localOnlyMode],
  );

  const placeholder = useMemo(() => !activeId
    ? connState !== "connected"
      ? "可先输入并发送，连接后会自动发出"
      : "输入消息开始新对话，Enter 发送"
    : connState !== "connected"
      ? "可先输入并发送，连接后会自动发出"
      : "输入消息或拖入文件，Enter 发送", [activeId, connState]);

  /** 居中输入：新对话 compose 模式且尚未发送首条消息（输入过程中保持居中） */
  const composerCentered = !composerDocked;
  const showEmptyHero = messages.length === 0 && (!composerDocked || heroExiting);
  const chatScrollCentered = !composerDocked && messages.length === 0;

  const [quickStartGroup, setQuickStartGroup] = useState(0);

  useEffect(() => {
    if (showEmptyHero && !heroExiting) {
      setQuickStartGroup((g) => (g + 1) % QUICK_START_GROUPS);
    }
  }, [showEmptyHero, heroExiting]);

  const quickStarts = useMemo(() => {
    const start = quickStartGroup * TASK_TEMPLATE_GROUP_SIZE;
    return TASK_TEMPLATES.slice(start, start + TASK_TEMPLATE_GROUP_SIZE);
  }, [quickStartGroup]);

  useLayoutEffect(() => {
    if (composerCentered) return;
    requestAnimationFrame(() => {
      draftRef.current?.focus({ preventScroll: true });
    });
  }, [composerCentered]);

  const composerBarProps = useMemo(() => ({
    draft,
    onDraftChange: setDraft,
    draftRef,
    placeholder,
    composerDisabled,
    sendDisabled,
    composerDisabledReason: composerDisabledReason ?? sendBlockedReason,
    canAttachFiles,
    busy,
    voiceListening,
    voiceChecking,
    voiceInterim,
    pendingAttachments,
    onRemoveAttachment: removePendingAttachment,
    onAttachFiles: onAttachClick,
    onToggleVoice: toggleVoiceInput,
    onPrimaryAction: onPrimaryComposerAction,
    fileInputRef,
    onFileInputChange,
    hasContextCards: pendingContextCards.length > 0,
    localOnlyMode,
    onToggleLocalOnly: toggleLocalOnlyMode,
    localOnlySuggest,
  }), [
    draft, placeholder, composerDisabled, sendDisabled,
    composerDisabledReason, sendBlockedReason, canAttachFiles,
    busy, voiceListening, voiceChecking, voiceInterim,
    pendingAttachments, pendingContextCards.length, removePendingAttachment, onAttachClick,
    toggleVoiceInput,
    onPrimaryComposerAction, onFileInputChange,
    draftRef, fileInputRef, setDraft,
    localOnlyMode, toggleLocalOnlyMode, localOnlySuggest,
  ]);

  const emptyHeroSubtitle = useMemo(() => !activeId
    ? null
    : connState !== "connected"
      ? "可先发送消息，连接本机服务后会自动发出。"
      : "在下方输入，Enter 发送；也可选用快捷任务模板。", [activeId, connState]);

  const quickStartDisabled = sessionBusy || connState !== "connected";

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <ConfirmDialog
        open={deleteTargetId !== null && !!activeId}
        title="删除这条消息？"
        titleId="chat-delete-msg-title"
        variant="danger"
        confirmLabel="删除"
        onClose={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (!activeId || !deleteTargetId) return;
          const mid = deleteTargetId;
          setDeleteTargetId(null);
          try {
            await deleteMessage(activeId, mid);
          } catch (e) {
            showToast(e instanceof Error ? e.message : String(e), "error");
          }
        }}
      >
        <p>将从本机对话中移除此条；仅影响本窗口已保存的副本，不会删除本机服务侧历史（若仍保留）。</p>
      </ConfirmDialog>

      {lastError && connState !== "connecting" && !startupPhase && !isGenericSendAbortBanner(lastError) && (
        <div
          className={[
            "yt-alert-enter mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-xs text-[var(--text-primary)] mx-12",
            isConnectSlowHint(lastError)
              ? "border border-[color-mix(in_oklab,var(--color-warn)_25%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)]"
              : "border border-[color-mix(in_oklab,var(--color-error)_25%,transparent)] bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]",
          ].join(" ")}
          role={isConnectSlowHint(lastError) ? "status" : "alert"}
        >
          <div className="min-w-0 flex-1 leading-relaxed">
            {humanizeConnectError(lastError) || sanitizeUserFacingCopy(lastError)}
          </div>
          {(connState === "error" || connState === "disconnected") && (
            <button
              type="button"
              onClick={() => {
                const profile = getLaunchConnectProfile();
                void requestDesktopConnect({
                  context: "重连",
                  direct: true,
                  fastReopen: connState !== "error",
                  maxMs: profile.startupConnectMaxMs,
                });
              }}
              className="yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2 py-1 text-[11px] font-medium text-white"
            >
              重连
            </button>
          )}
          <button
            type="button"
            onClick={() => useGatewayStore.setState({ lastError: null })}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[color-mix(in_oklab,var(--color-error)_20%,transparent)]"
          >
            关闭
          </button>
        </div>
      )}

      {connBannerVisible && !lastError && (
        <div
          className="yt-alert-enter mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_25%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--text-primary)] mx-12"
          role="status"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warn)] animate-pulse" />
          <span className="min-w-0 flex-1 leading-relaxed">
            {connState === "connecting" && startupPhase
              ? sanitizeUserFacingCopy(startupPhase)
              : draft.trim() || pendingContextCards.length > 0
                ? "服务已断开，草稿已保留；重连后可继续发送"
                : "服务已断开，正在重连…"}
          </span>
          <button
            type="button"
            onClick={() => {
              const profile = getLaunchConnectProfile();
              void requestDesktopConnect({
                context: "重连",
                direct: true,
                fastReopen: connState !== "error",
                maxMs: profile.startupConnectMaxMs,
              });
            }}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2 py-1 text-[11px] font-medium text-white"
          >
            手动重连
          </button>
          <button
            type="button"
            onClick={() => {
              releaseConnectPipelineUiPhase();
              setConnBannerVisible(false);
            }}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            忽略
          </button>
        </div>
      )}

      {lastRetryableSend?.sessionId === activeId && !busy && !showInterruptedContinue && (
        <div
          className="yt-alert-enter mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--text-primary)] mx-12"
          role="status"
        >
          <div className="min-w-0 flex-1 leading-relaxed">上一条消息未收到完整回复，可重试发送（不会重复保存用户消息）。</div>
          <button
            type="button"
            onClick={() => void retryLastSend()}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2 py-1 text-[11px] font-medium text-white"
          >
            重试发送
          </button>
          <button
            type="button"
            onClick={() => dismissRetryableSend()}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-primary)] hover:bg-[color-mix(in_oklab,var(--color-warn)_20%,transparent)]"
          >
            忽略
          </button>
        </div>
      )}

      {showInterruptedContinue && connState === "connected" && (
        <div
          className="yt-alert-enter mt-2 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--brand-color)_25%,transparent)] bg-[var(--brand-tint-8)] px-3 py-2 text-xs text-[var(--text-primary)] mx-12"
          role="status"
        >
          <div className="min-w-0 flex-1 leading-relaxed">
            上一条回复未完成，已保存已输出内容。点「继续生成」可从断点续写。
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSend("继续")}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          >
            继续生成
          </button>
        </div>
      )}

      {contextPressure && hasRemoteSession && connState === "connected" && (
        <div
          className="mx-12 mt-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_28%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_6%,var(--bg-elevated))] px-3 py-2 text-xs text-[var(--text-primary)]"
          role="status"
        >
          <div className="min-w-0 flex-1 leading-relaxed">
            {contextPressureBannerText(approxTokens)}
          </div>
          <button
            type="button"
            disabled={compactingContext || busy}
            onClick={() => {
              setCompactingContext(true);
              void compactActiveSessionForUi().finally(() => setCompactingContext(false));
            }}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2 py-1 text-[11px] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
          >
            {compactingContext ? "压缩中…" : "压缩上下文"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => requestOpenModelSelector()}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-color)] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
          >
            换模型
          </button>
          <button
            type="button"
            disabled={summarizingHandoff || busy}
            onClick={() => {
              setSummarizingHandoff(true);
              void summarizeAndContinueInNewChat().finally(() => setSummarizingHandoff(false));
            }}
            className="yt-transition shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2 py-1 text-[11px] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
          >
            {summarizingHandoff ? "处理中…" : "摘要并新建"}
          </button>
        </div>
      )}

      {chatCollapsed && (
        <div className="chat-collapsed-bar mx-8 mt-2 rounded-[var(--radius-md)]">
          <button
            type="button"
            onClick={toggleChatCollapsed}
            className="yt-btn-svc yt-transition rounded-[var(--radius-md)] px-2.5 py-1 text-xs"
          >
            展开对话
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--text-primary)]">
              {active?.title ?? "新对话"}
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              消息区已收起，仍可在此输入发送
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] tabular-nums text-[var(--text-tertiary)]">
            {messages.length} 条
          </span>
        </div>
      )}

      <div
        className={[
          "relative mt-1 flex min-h-0 flex-1 flex-col overflow-hidden",
          chatCollapsed ? "justify-end" : "",
        ].join(" ")}
        onDragOver={onComposerDragOver}
        onDragLeave={onComposerDragLeave}
        onDrop={(e) => void onComposerDrop(e)}
        onPaste={onChatPaste}
      >
        {dragOverComposer && canAttachFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center yt-panel-fade-in bg-[color-mix(in_oklab,var(--bg-app)_35%,transparent)] backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-[color-mix(in_oklab,var(--brand-color)_30%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--bg-elevated)_82%,transparent)] px-8 py-5 shadow-[0_8px_32px_color-mix(in_oklab,var(--bg-app)_25%,transparent)]">
              <svg className="h-6 w-6 text-[var(--brand-color)] opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <span className="text-sm font-medium text-[var(--text-primary)]">松开以添加文件</span>
              <span className="text-xs text-[var(--text-muted)]">支持拖入到对话任意区域</span>
            </div>
          </div>
        )}
        {!chatCollapsed && (
        <div
          ref={listRef}
          onScroll={onListScroll}
          className={[
            "chat-main-scroll min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-8 py-6 pb-36 md:px-12",
            // overflow-anchor 置 none：避免浏览器默认锚定与 JS scrollTop 分配相互打架
            // 导致新内容出现时 scroll 位置往上弹一下再回来
            "overflow-anchor-none",
            chatScrollCentered ? "chat-main-scroll--centered" : "",
            chatScrollCentered ? "flex flex-col justify-center" : "",
          ].join(" ")}
          role="log"
          aria-label="消息"
        >
          {(hasMoreMessages || loadingOlderMessages) && messages.length > 0 && (
            <div className="flex justify-center pb-2">
              <button
                type="button"
                disabled={loadingOlderMessages || !hasMoreMessages}
                onClick={() => {
                  if (!activeId || loadingOlderMessages || !hasMoreMessages) return;
                  const el = listRef.current;
                  const prevHeight = el?.scrollHeight ?? 0;
                  const prevTop = el?.scrollTop ?? 0;
                  void loadOlderMessages(activeId).then(() => {
                    requestAnimationFrame(() => {
                      const nextEl = listRef.current;
                      if (nextEl && prevHeight) {
                        nextEl.scrollTop = nextEl.scrollHeight - prevHeight + prevTop;
                      }
                    });
                  });
                }}
                className="yt-transition rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              >
                {loadingOlderMessages ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-subtle)] border-t-[var(--brand-color)]" />
                    加载中…
                  </span>
                ) : "加载更早消息"}
              </button>
            </div>
          )}
          <ChatMessageList
            messages={messages}
            scrollRef={listRef}
            activeAgent={activeAgent}
            onDelete={handleDeleteMessage}
          />
          {isLoadingMessages && messages.length === 0 && (
            <div className="flex flex-col gap-0 py-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <ChatMessageSkeleton key={i} isUser={i % 2 === 1} />
              ))}
            </div>
          )}
          {activeId && active && (
            <ChatStreamingBubble
              sessionId={activeId}
              activeAgent={activeAgent}
              progressLabel={sendProgressLabel}
              onContentChange={onStreamContentChange}
            />
          )}
          {showPipelineBusy && active && connState === "connected" && !isSending && (
            <div className="message-enter-assistant flex w-full justify-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--color-warn)_12%,var(--bg-elevated))]">
                <div className="h-2.5 w-2.5 rounded-full bg-[var(--color-warn)] animate-pulse" aria-hidden />
              </div>
              <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-warn)]/30 bg-[color-mix(in_oklab,var(--color-warn)_8%,var(--bg-elevated))] px-4 py-2 text-sm text-[var(--color-warn)]">
                <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-80"
                    fill="currentColor"
                    d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
                  />
                </svg>
                任务流进行中
              </div>
            </div>
          )}
          {showEmptyHero && (
            <ChatEmptyHeroMotion active={!heroExiting} exiting={heroExiting}>
            <div className={["chat-empty-hero", composerCentered ? "chat-empty-hero--with-inline-composer" : ""].join(" ")}>
              <div className="chat-empty-hero__icon-wrap">
                <div className="chat-empty-hero__glow" aria-hidden />
                <div className="chat-empty-hero__icon">
                  <ChatEmptyIcon />
                </div>
              </div>
              <div className="chat-empty-hero__copy">
                <p className="chat-empty-hero__title">开始一个新的对话</p>
                {emptyHeroSubtitle ? (
                  <p className="chat-empty-hero__subtitle">{emptyHeroSubtitle}</p>
                ) : null}
                <div
                  className={[
                    "quick-start-row",
                    emptyHeroSubtitle ? "mt-5" : "mt-3",
                  ].join(" ")}
                >
                  {quickStarts.map((q, i) => (
                    <button
                      key={q.label}
                      type="button"
                      disabled={quickStartDisabled}
                      onClick={() => void onQuickStart(q)}
                      className="quick-start-chip"
                      style={{ "--i": i } as React.CSSProperties}
                      title={q.goal}
                    >
                      <QuickStartIcon kind={q.icon} />
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
              {composerCentered && (
                <div className="chat-composer-inline-slot w-full max-w-[52rem]">
                  <ChatContextCardStrip
                    cards={pendingContextCards}
                    onRemove={(index) =>
                      setPendingContextCards((prev) => prev.filter((_, i) => i !== index))
                    }
                  />
                  <ChatComposerBar {...composerBarProps} layout="inline" />
                </div>
              )}
            </div>
            </ChatEmptyHeroMotion>
          )}
        </div>
        )}

        {!chatCollapsed && showScrollChip && (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="chat-scroll-chip"
            style={{ bottom: "max(1.25rem, calc(1rem + var(--composer-height, 52px)))" }}
            aria-label="滚动到最新消息"
          >
            ↓ 新消息
          </button>
        )}

        {!composerCentered && (
          <ComposerDockMotion visible animKey={composerDockAnimKey}>
            <ChatContextCardStrip
              cards={pendingContextCards}
              onRemove={(index) =>
                setPendingContextCards((prev) => prev.filter((_, i) => i !== index))
              }
            />
            <ChatComposerBar {...composerBarProps} layout="bottom" />
          </ComposerDockMotion>
        )}
      </div>
    </div>
  );
});
