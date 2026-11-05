import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { gsap } from "../../lib/gsap/setup";
import { prefersReducedMotion } from "../../lib/gsap/setup";

type Props = {
  open: boolean;
  title: string;
  titleId: string;
  children: ReactNode;
  /** 高后果操作：危险（红色主按钮） */
  variant?: "default" | "danger";
  confirmLabel: string;
  cancelLabel?: string;
  /** 仅展示取消/关闭（如 Agent 选择器） */
  hideConfirm?: boolean;
  /** 隐藏取消按钮（强制单选确认场景） */
  hideCancel?: boolean;
  /** 是否允许 Esc / 点击遮罩关闭（默认 true） */
  dismissible?: boolean;
  /** 禁用确认按钮（防重复提交）；不锁取消/Esc/遮罩 */
  confirmDisabled?: boolean;
  /** 锁定整窗（含取消），仅用于不可关闭的强制确认 */
  disabled?: boolean;
  /** 确认按钮显示加载中状态 */
  confirmLoading?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  title,
  titleId,
  children,
  variant = "default",
  confirmLabel,
  cancelLabel = "取消",
  hideConfirm = false,
  hideCancel = false,
  dismissible = true,
  disabled = false,
  confirmDisabled = false,
  confirmLoading = false,
  onClose,
  onConfirm,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disabled && dismissible) {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // 焦点陷阱：在对话框内部循环 Tab，避免键盘焦点逃逸到背景内容。
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    if (hideCancel) {
      confirmRef.current?.focus();
    } else {
      cancelRef.current?.focus();
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      // 关闭时把焦点还给触发对话框的元素，符合可访问性预期。
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose, disabled, dismissible, hideCancel]);

  /* 入场动画 */
  useEffect(() => {
    if (!open || !backdropRef.current || !panelRef.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        backdropRef.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.2, ease: "power2.out" },
      );
      gsap.fromTo(
        panelRef.current,
        { autoAlpha: 0, scale: 0.95, y: -8 },
        { autoAlpha: 1, scale: 1, y: 0, duration: 0.28, ease: "power3.out" },
      );
    });
    return () => ctx.revert();
  }, [open]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal
      aria-labelledby={titleId}
      onClick={disabled || !dismissible ? undefined : onClose}
    >
      <div
        ref={panelRef}
        className="glass-panel w-full max-w-md rounded-xl p-6 text-left shadow-lg text-[var(--text-secondary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div id={titleId} className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </div>
        <div className="mt-2 text-sm leading-relaxed">{children}</div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {!hideCancel && (
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={disabled}
            className="yt-press rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_oklab,var(--brand-color)_35%,transparent)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          )}
          {!hideConfirm && (
            <button
              ref={confirmRef}
              type="button"
              onClick={() => void onConfirm()}
              disabled={disabled || confirmDisabled}
              className={[
                "yt-press rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                variant === "danger"
                  ? "bg-[var(--color-error)] text-white hover:bg-[color-mix(in_oklab,#000_15%,var(--color-error))] focus-visible:outline-[color-mix(in_oklab,var(--color-error)_50%,transparent)]"
                  : "bg-[var(--brand-color)] text-white hover:bg-[var(--brand-color-emphasis)] focus-visible:outline-[color-mix(in_oklab,var(--brand-color)_40%,transparent)]",
              ].join(" ")}
            >
              {confirmLabel}
              {confirmLoading && (
                <svg className="ml-1.5 inline-block h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" className="opacity-30" />
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" strokeDashoffset="24" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
