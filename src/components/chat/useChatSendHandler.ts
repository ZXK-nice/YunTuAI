import { useCallback, useRef } from "react";
import {
  chatSaveUploadFiles,
  chatSaveUploadPaths,
  toMessageFileEntries,
} from "../../lib/chat/chat-files-bridge";
import { appendUserMessageWithFiles } from "../../lib/chat/append-message-with-files";
import {
  encodeMessageDisplayContent,
  MAX_ATTACHMENT_BYTES,
  pendingAttachmentPaths,
  pendingAttachmentsToUploadPayload,
  type PendingChatAttachment,
} from "../../lib/chat/message-files";
import { encodeContextMessage } from "../../lib/chat/context-cards";
import type { SessionsSendAttachment } from "../../lib/openclaw/session-rpc";
import { prepareChatAttachmentPayload } from "../../lib/chat/useChatAttachmentPrep";
import { SEND_PROGRESS } from "../../lib/chat/send-progress";
import type { ChatContextCard } from "../../lib/chat/context-cards";
import { modelUsesDirectVision, resolveSelectionToModelId } from "../../lib/models/catalog";
import { sessionAgentMatchesActive } from "../../lib/yuntuai/kb-assistant-send-policy";
import { useSessionStore } from "../../stores/sessionStore";
import { useModelStore } from "../../stores/modelStore";
import { useUiStore } from "../../stores/uiStore";
import { humanizeIpcError } from "../../lib/chat/humanize-ipc-error";

export type UseChatSendHandlerOpts = {
  active: { id: string } | null | undefined;
  activeAgentId: string | null;
  busy: boolean;
  connState: string;
  draft: string;
  pendingAttachments: PendingChatAttachment[];
  pendingContextCards: ChatContextCard[];
  localOnlyMode: boolean;
  setDraft: (v: string) => void;
  setPendingContextCards: (v: ChatContextCard[] | ((prev: ChatContextCard[]) => ChatContextCard[])) => void;
  setPendingAttachments: (v: PendingChatAttachment[] | ((prev: PendingChatAttachment[]) => PendingChatAttachment[])) => void;
  draftRef: React.RefObject<HTMLTextAreaElement | null>;
  dockComposerWithMotion: () => void;
  createSession: (agentId?: string) => Promise<void>;
};

/** ChatPanel 发送管线（附件保存 → 预提取 → 落库 → sessionStore.sendMessage）。 */
export function useChatSendHandler(opts: UseChatSendHandlerOpts) {
  const sendInFlightRef = useRef(false);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setSendProgress = useSessionStore((s) => s.setSendProgress);
  const showToast = useUiStore((s) => s.showToast);

  const onSend = useCallback(
    async (overrideText?: string) => {
      if (opts.busy || sendInFlightRef.current) return;
      const trimmed = (overrideText ?? opts.draft).trim();
      const contextCards = opts.pendingContextCards;
      const hasContextCards = contextCards.length > 0;
      if (!trimmed && opts.pendingAttachments.length === 0 && !hasContextCards) return;

      sendInFlightRef.current = true;
      const savedDraft = opts.draft;
      const savedCards = contextCards;
      const savedAttachments = opts.pendingAttachments;
      opts.dockComposerWithMotion();

      try {
        if (!opts.active) {
          await opts.createSession(opts.activeAgentId ?? undefined);
        }

        let activeSession = useSessionStore.getState().sessions.find(
          (s) => s.id === useSessionStore.getState().activeId,
        );
        if (
          opts.activeAgentId &&
          activeSession &&
          !sessionAgentMatchesActive(activeSession.agentId, opts.activeAgentId)
        ) {
          await opts.createSession(opts.activeAgentId);
          activeSession = useSessionStore.getState().sessions.find(
            (s) => s.id === useSessionStore.getState().activeId,
          );
        }
        if (!activeSession) return;

        const batchId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        const sendStartedAtMs = Date.now();

        let attachedFiles: ReturnType<typeof toMessageFileEntries> = [];
        if (opts.pendingAttachments.length > 0) {
          setSendProgress(SEND_PROGRESS.SAVING_ATTACHMENTS);
          for (const a of opts.pendingAttachments) {
            if (a.size > MAX_ATTACHMENT_BYTES) {
              showToast(`「${a.name}」超过 48MB 上限`, "error");
              return;
            }
          }
          try {
            const pathList = pendingAttachmentPaths(opts.pendingAttachments);
            const fileOnly = opts.pendingAttachments.filter((a) => !a.path);
            const savedParts: ReturnType<typeof toMessageFileEntries> = [];
            if (fileOnly.length > 0) {
              const uploadPayload = await pendingAttachmentsToUploadPayload(fileOnly);
              if (uploadPayload.length > 0) {
                const saved = await chatSaveUploadFiles(batchId, uploadPayload);
                if (!saved?.length) {
                  showToast("附件保存失败，请重试", "error");
                  return;
                }
                savedParts.push(...toMessageFileEntries(saved));
              }
            }
            if (pathList.length > 0) {
              const saved = await chatSaveUploadPaths(batchId, pathList);
              if (!saved?.length) {
                showToast("附件保存失败，请重试", "error");
                return;
              }
              savedParts.push(...toMessageFileEntries(saved));
            }
            attachedFiles = savedParts;
          } catch (e) {
            showToast(humanizeIpcError(e instanceof Error ? e.message : String(e)), "error");
            return;
          }
        }

        const textFiles = opts.pendingAttachments.filter(
          (a): a is PendingChatAttachment & { kind: "text"; content: string } =>
            a.kind === "text" && typeof a.content === "string" && a.content.trim().length > 0,
        );
        const fileNames = attachedFiles.map((f) => f.name).join("、");
        for (const card of contextCards) {
          if (card.kind === "image") {
            const name = card.path.split(/[/\\]/).pop() ?? "image.png";
            if (!attachedFiles.some((f) => f.path === card.path)) {
              attachedFiles.push({ name, path: card.path });
            }
          }
        }
        const localDisplay =
          trimmed ||
          (hasContextCards ? "（附带结构化上下文）" : fileNames ? `（附件：${fileNames}）` : "（附件）");

        let remotePayload = trimmed;
        let visionAttachments: SessionsSendAttachment[] | undefined;
        if (attachedFiles.length > 0) {
          const selectionId = useModelStore.getState().selectionId;
          const resolvedModelId = resolveSelectionToModelId(selectionId);
          const useDirectVision = modelUsesDirectVision(resolvedModelId);
          const prep = await prepareChatAttachmentPayload(
            {
              trimmed,
              attachedFiles,
              batchId,
              textFiles,
              hasContextCards,
              fileNames,
              localDisplay,
              useDirectVision,
            },
            setSendProgress,
          );
          remotePayload = prep.remotePayload;
          visionAttachments = prep.visionAttachments;
          if (prep.toast) {
            showToast(prep.toast.message, prep.toast.variant);
          }
        } else if (!remotePayload) {
          remotePayload = localDisplay;
        }

        opts.setDraft("");
        opts.setPendingContextCards([]);
        if (opts.draftRef.current) opts.draftRef.current.style.height = "auto";

        const freshActiveId = useSessionStore.getState().activeId;
        if (freshActiveId) {
          const userDisplayContent = hasContextCards
            ? encodeContextMessage(localDisplay, contextCards, attachedFiles)
            : attachedFiles.length > 0
              ? encodeMessageDisplayContent(localDisplay, attachedFiles)
              : undefined;
          try {
            const row = await appendUserMessageWithFiles(freshActiveId, localDisplay, userDisplayContent);
            if (row) {
              useSessionStore.getState().appendLocalMessage(freshActiveId, {
                ...row,
                sendStatus: "sending",
              });
            }
          } catch (e) {
            opts.setDraft(savedDraft);
            opts.setPendingContextCards(savedCards);
            showToast(humanizeIpcError(e instanceof Error ? e.message : String(e)), "error");
            return;
          }
        }

        const retrySnap = useSessionStore.getState().lastRetryableSend;
        try {
          await sendMessage(
            {
              localDisplay,
              remotePayload,
              workspaceTextFiles:
                textFiles.length > 0
                  ? textFiles.map((f) => ({ displayName: f.name, content: f.content }))
                  : undefined,
              workspaceBatchId: attachedFiles.length > 0 ? batchId : undefined,
              attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
              sendStartedAtMs,
              visionAttachments,
            },
            { skipUserAppend: true, localOnlyMode: opts.localOnlyMode },
          );
          const afterRetry = useSessionStore.getState().lastRetryableSend;
          const sendFailed =
            afterRetry !== retrySnap && afterRetry?.sessionId === freshActiveId;
          if (sendFailed) {
            opts.setDraft(savedDraft);
            opts.setPendingContextCards(savedCards);
            opts.setPendingAttachments(savedAttachments);
          } else {
            opts.setPendingAttachments([]);
          }
        } catch (e) {
          opts.setDraft(savedDraft);
          opts.setPendingContextCards(savedCards);
          opts.setPendingAttachments(savedAttachments);
          showToast(humanizeIpcError(e instanceof Error ? e.message : String(e)), "error");
        }
      } finally {
        sendInFlightRef.current = false;
        const sess = useSessionStore.getState();
        if (!sess.isSending && !sess.queuedSendPending) {
          sess.setSendProgress(null);
        }
      }
    },
    [
      opts.active,
      opts.activeAgentId,
      opts.busy,
      opts.connState,
      opts.createSession,
      opts.dockComposerWithMotion,
      opts.draft,
      opts.draftRef,
      opts.localOnlyMode,
      opts.pendingAttachments,
      opts.pendingContextCards,
      opts.setDraft,
      opts.setPendingAttachments,
      opts.setPendingContextCards,
      sendMessage,
      setSendProgress,
      showToast,
    ],
  );

  return { onSend, sendInFlightRef };
}
