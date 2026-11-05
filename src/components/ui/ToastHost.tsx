import { useCallback, useEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion } from "../../lib/gsap/setup";
import { useUiStore, type ToastVariant, type ToastAction } from "../../stores/uiStore";

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

function IconInfo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
    </svg>
  );
}

const variantClass: Record<ToastVariant, string> = {
  success: "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]",
  error:
    "border-[color-mix(in_oklab,var(--color-error)_28%,transparent)] bg-[var(--bg-elevated)] text-[var(--text-primary)]",
  info: "border-[var(--separator)] bg-[var(--bg-elevated)] text-[var(--text-primary)]",
  warning:
    "border-[color-mix(in_oklab,var(--color-warn)_28%,transparent)] bg-[var(--bg-elevated)] text-[var(--text-primary)]",
};

const variantIcon: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: IconCheck,
  error: IconX,
  info: IconInfo,
  warning: IconInfo,
};

const variantIconColor: Record<ToastVariant, string> = {
  success: "text-[var(--brand-color)]",
  error: "text-[var(--color-error)]",
  info: "text-[var(--brand-color)]",
  warning: "text-[var(--color-warn)]",
};

export function ToastHost() {
  const storeToast = useUiStore((s) => s.toast);
  const storeDismiss = useUiStore((s) => s.dismissToast);
  const toastRef = useRef<HTMLDivElement>(null);
  const [localToast, setLocalToast] = useState<typeof storeToast>(null);
  const leavingRef = useRef(false);

  const prevToastRef = useRef<typeof storeToast>(null);
  useEffect(() => {
    const prev = prevToastRef.current;
    prevToastRef.current = storeToast;

    if (storeToast) {
      if (toastRef.current) gsap.killTweensOf(toastRef.current);
      leavingRef.current = false;
      setLocalToast(storeToast);
    } else if (prev && !storeToast && localToast && !leavingRef.current) {
      leavingRef.current = true;
      if (toastRef.current && !prefersReducedMotion()) {
        gsap.to(toastRef.current, {
          autoAlpha: 0,
          y: -16,
          scale: 0.96,
          duration: 0.25,
          ease: "power2.in",
          onComplete: () => {
            if (!leavingRef.current) return;
            leavingRef.current = false;
            setLocalToast(null);
          },
        });
      } else {
        leavingRef.current = false;
        setLocalToast(null);
      }
    }
  }, [storeToast]);

  useEffect(() => {
    if (!storeToast || !toastRef.current || prefersReducedMotion()) return;
    gsap.fromTo(
      toastRef.current,
      { autoAlpha: 0, y: -16, scale: 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.38, ease: "power3.out" },
    );
  }, [storeToast]);

  const handleDismiss = useCallback(() => {
    storeDismiss();
  }, [storeDismiss]);

  const handleAction = useCallback(
    (action: ToastAction) => {
      action.onClick();
      storeDismiss();
    },
    [storeDismiss],
  );

  const visible = localToast || storeToast;
  if (!visible) return null;

  const Icon = variantIcon[visible.variant];
  const iconColor = variantIconColor[visible.variant];

  return (
    <div className="yt-toast-host" aria-hidden={false}>
      <div
        ref={toastRef}
        className="pointer-events-none absolute left-1/2 top-2 z-[200] w-[min(100%-2rem,32rem)] -translate-x-1/2 px-2"
        role="status"
        aria-live="polite"
        aria-atomic
      >
        <div
          className={[
            "pointer-events-auto flex min-h-[2.25rem] items-center gap-2 rounded-full border px-4 py-2 text-[13px] leading-snug shadow-[var(--shadow-md)]",
            variantClass[visible.variant],
          ].join(" ")}
        >
          <Icon className={["h-4 w-4 shrink-0", iconColor].join(" ")} />

          <p className="min-w-0 flex-1 whitespace-pre-wrap text-pretty [overflow-wrap:anywhere]">{visible.message}</p>

          {visible.action && (
            <button
              type="button"
              onClick={() => handleAction(visible.action!)}
              className="yt-press shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand-color)] hover:bg-[var(--brand-surface-select)]"
            >
              {visible.action.label}
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            className="yt-press shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
