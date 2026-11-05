import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  chatInspectDroppedPaths,
  inspectedToPendingAttachments,
} from "../../lib/chat/chat-files-bridge";
import {
  filesToPendingAttachments,
  MAX_ATTACHMENT_BYTES,
  type PendingChatAttachment,
} from "../../lib/chat/message-files";
import { guardPendingAttachmentNames } from "../../lib/chat/pending-attachment-guard";
import { enrichPendingAttachmentPreview } from "../../lib/chat/attachment-preview";
import { useTauriFileDrop } from "../../lib/chat/use-tauri-file-drop";

type ToastFn = (message: string, variant: "info" | "warning" | "error" | "success") => void;

export function useChatPendingAttachments(opts: {
  canAttachFiles: boolean;
  showToast: ToastFn;
  composeResetTick: number;
}) {
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [dragOverComposer, setDragOverComposer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPendingAttachments([]);
  }, [opts.composeResetTick]);

  const queueAttachmentPreview = useCallback((att: PendingChatAttachment) => {
    setPendingAttachments((prev) =>
      prev.map((a) =>
        a.id === att.id ? { ...a, extractStatus: "extracting", extractHint: "正在识别…" } : a,
      ),
    );
    void enrichPendingAttachmentPreview(att)
      .then((patch) => {
        const nextStatus = patch.extractStatus ?? "office_ok";
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? {
                  ...a,
                  extractStatus: nextStatus,
                  extractHint: patch.extractHint ?? "已加入附件",
                }
              : a,
          ),
        );
      })
      .catch(() => {
        setPendingAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? { ...a, extractStatus: "office_fail", extractHint: "预读失败，仍可发送" }
              : a,
          ),
        );
      });
  }, []);

  const appendAttachments = useCallback(
    (items: PendingChatAttachment[]) => {
      if (!items.length) return;
      setPendingAttachments((prev) => [...prev, ...items]);
      for (const att of items) {
        queueAttachmentPreview(att);
      }
    },
    [queueAttachmentPreview],
  );

  const addFilesToPending = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const oversize = files.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (oversize) {
      opts.showToast(`「${oversize.name}」超过 48MB 上限`, "error");
      return;
    }
    const legacyGuard = guardPendingAttachmentNames(files.map((f) => f.name));
    if (!legacyGuard.ok) {
      opts.showToast(legacyGuard.message, "error");
      return;
    }
    const next = await filesToPendingAttachments(files);
    appendAttachments(next);
  }, [opts.showToast, appendAttachments]);

  const addPathsToPending = useCallback(async (paths: string[]) => {
    if (!paths.length || !opts.canAttachFiles) return;
    try {
      const inspected = await chatInspectDroppedPaths(paths);
      if (!inspected?.length) {
        opts.showToast("无法读取拖入的文件", "error");
        return;
      }
      const oversize = inspected.find((f) => f.size > MAX_ATTACHMENT_BYTES);
      if (oversize) {
        opts.showToast(`「${oversize.name}」超过 48MB 上限`, "error");
        return;
      }
      const legacyGuard = guardPendingAttachmentNames(inspected.map((f) => f.name));
      if (!legacyGuard.ok) {
        opts.showToast(legacyGuard.message, "error");
        return;
      }
      const next = inspectedToPendingAttachments(inspected);
      appendAttachments(next);
    } catch (e) {
      opts.showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [opts.canAttachFiles, opts.showToast, appendAttachments]);

  useTauriFileDrop({
    enabled: opts.canAttachFiles,
    onPaths: (paths) => {
      void addPathsToPending(paths);
    },
    onHoverChange: setDragOverComposer,
  });

  const onAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    await addFilesToPending(files);
    e.target.value = "";
  }, [addFilesToPending]);

  const onComposerDragOver = useCallback((e: React.DragEvent) => {
    if (!opts.canAttachFiles) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverComposer(true);
  }, [opts.canAttachFiles]);

  const onComposerDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverComposer(false);
  }, []);

  const onComposerDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverComposer(false);
    if (!opts.canAttachFiles) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) {
      await addFilesToPending(files);
    }
  }, [addFilesToPending, opts.canAttachFiles]);

  const onChatPaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!opts.canAttachFiles) return;
      const files = e.clipboardData.files;
      if (!files?.length) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        if (files[i]!.type.startsWith("image/")) {
          imageFiles.push(files[i]!);
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        void addFilesToPending(imageFiles);
      }
    },
    [opts.canAttachFiles, addFilesToPending],
  );

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return {
    pendingAttachments,
    setPendingAttachments,
    dragOverComposer,
    fileInputRef,
    addFilesToPending,
    removePendingAttachment,
    onAttachClick,
    onFileInputChange,
    onComposerDragOver,
    onComposerDragLeave,
    onComposerDrop,
    onChatPaste,
  };
}

/** 根据输入框高度同步 composer CSS 变量（供 scroll-chip 定位）。 */
export function useComposerHeightSync(opts: {
  draft: string;
  pendingAttachmentCount: number;
  composerDisabled: boolean;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const el = opts.draftRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = "auto";
      const h = Math.min(el.scrollHeight, 208);
      el.style.height = `${h}px`;
      const parent = opts.listRef.current?.parentElement;
      if (parent) {
        const dock = parent.querySelector<HTMLElement>(".chat-composer-dock");
        const dockH = dock?.getBoundingClientRect().height ?? 0;
        parent.style.setProperty("--composer-height", `${Math.max(h + 16, dockH || 52)}px`);
      }
    });
  }, [opts.draft, opts.pendingAttachmentCount, opts.composerDisabled, opts.draftRef, opts.listRef]);
}
