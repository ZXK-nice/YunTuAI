import type { ReactNode } from "react";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";

type FrameProps = {
  connState: GatewayConnStateWord;
  description: string;
  busy: boolean;
  onRefresh: () => void;
  children: ReactNode;
  actions?: ReactNode;
};

export function ConsoleSectionFrame({
  connState,
  description,
  busy,
  onRefresh,
  children,
  actions,
}: FrameProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <button
            type="button"
            className="yt-btn-svc text-xs"
            disabled={busy || connState !== "connected"}
            onClick={onRefresh}
          >
            {busy ? "刷新中…" : "刷新"}
          </button>
        </div>
      </div>
      {connState !== "connected" ? (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] p-6 text-center text-sm text-[var(--text-tertiary)]">
          连接 Gateway 后可操作
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function ConsoleRow({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-[var(--text-primary)]">{title}</div>
        {subtitle ? (
          <div className="truncate text-[10px] text-[var(--text-tertiary)]">{subtitle}</div>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap gap-1">{children}</div> : null}
    </div>
  );
}

export function ConsoleMiniBtn({
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
}) {
  const cls =
    variant === "danger"
      ? "text-[var(--color-error)] border-[color-mix(in_oklab,var(--color-error)_35%,var(--border-subtle))]"
      : variant === "primary"
        ? "text-[var(--brand-color)] border-[color-mix(in_oklab,var(--brand-color)_35%,var(--border-subtle))]"
        : "text-[var(--text-secondary)] border-[var(--border-subtle)]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-[10px] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50 ${cls}`}
    >
      {label}
    </button>
  );
}

export function ConsoleJsonPreview({ data }: { data: unknown }) {
  const text =
    typeof data === "string"
      ? data
      : (() => {
          try {
            return JSON.stringify(data, null, 2);
          } catch {
            return String(data);
          }
        })();
  return (
    <pre className="max-h-48 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 text-[10px] text-[var(--text-secondary)]">
      {sanitizeUserFacingCopy(text).slice(0, 12_000)}
    </pre>
  );
}
