import { memo, type ReactNode } from "react";

export const panelGlass =
  "rounded-xl border border-[color-mix(in_oklab,var(--brand-color)_14%,var(--border-subtle))] bg-[var(--surface-glass)] shadow-[0_1px_0_color-mix(in_oklab,var(--brand-color)_5%,transparent)]";

export const checkerBg =
  "bg-[var(--bg-base)] [background-image:linear-gradient(45deg,color-mix(in_oklab,var(--border-subtle)_80%,transparent)_25%,transparent_25%),linear-gradient(-45deg,color-mix(in_oklab,var(--border-subtle)_80%,transparent)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,color-mix(in_oklab,var(--border-subtle)_80%,transparent)_75%),linear-gradient(-45deg,transparent_75%,color-mix(in_oklab,var(--border-subtle)_80%,transparent)_75%)] [background-size:14px_14px] [background-position:0_0,0_7px,7px_-7px,-7px_0]";

export function IconImageSpark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M3 16l5-5 4 4 3-3 6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 7l2-2 4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDownload({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M12 3v10m0 0l3.5-3.5M12 13l-3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2" strokeLinecap="round" />
    </svg>
  );
}

export function IconExternal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M14 5h5v5M10 14L19 5M19 14v5H5V5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const ImageStudioShell = memo(function ImageStudioShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-col gap-4">{children}</div>;
});

export const ImageStudioHero = memo(function ImageStudioHero({
  configured,
  worksCount,
  summary,
  actions,
}: {
  configured: boolean;
  worksCount: number;
  summary?: string | null;
  actions: ReactNode;
}) {
  return (
    <div className={`${panelGlass} overflow-hidden`}>
      <div className="relative px-5 py-4">
        <div
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 80% 120% at 100% -20%, color-mix(in oklab, var(--brand-color) 18%, transparent), transparent 55%)",
          }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]">
              <IconImageSpark className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">作图</h2>
                <StatusBadge configured={configured} />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                Seedream 5.0 Pro · 火山方舟 · 本机保存至{" "}
                <span className="font-mono text-[10px] text-[var(--text-muted)]">output/image-studio</span>
              </p>
              {summary ? (
                <p className="mt-1.5 truncate font-mono text-[10px] text-[var(--text-muted)]">{summary}</p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2">
          <StatPill label="作品" value={`${worksCount} 张`} />
          <StatPill label="能力" value="文生图 · 图生图" muted />
          <StatPill label="耗时" value="约 1～2 分钟/张" muted />
        </div>
      </div>
    </div>
  );
});

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        configured
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      ].join(" ")}
    >
      <span className={["h-1.5 w-1.5 rounded-full", configured ? "bg-emerald-500" : "bg-amber-500"].join(" ")} />
      {configured ? "API 已就绪" : "待配置"}
    </span>
  );
}

function StatPill({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/70 px-3 py-1">
      <span className="text-[10px] text-[var(--text-muted)]">{label} </span>
      <span className={["text-[10px] font-medium", muted ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"].join(" ")}>
        {value}
      </span>
    </div>
  );
}

export const ImageStudioCard = memo(function ImageStudioCard({
  title,
  hint,
  extra,
  children,
  className = "",
}: {
  title: string;
  hint?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${panelGlass} flex min-h-0 flex-col p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)]">{title}</h3>
          {hint ? <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{hint}</p> : null}
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
});

export function SizeChipGroup({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="输出尺寸">
      {options.map((s) => {
        const active = value === s;
        return (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onChange(s)}
            className={[
              "yt-transition min-w-[2.75rem] rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-40",
              active
                ? "border-[var(--brand-color)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--brand-color)]/40",
            ].join(" ")}
            aria-pressed={active}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

export function PromptSuggestionChips({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: { label: string; text: string }[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s.text)}
          className="yt-transition rounded-full border border-dashed border-[var(--border-default)] px-2.5 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:border-[var(--brand-color)]/50 hover:text-[var(--brand-color)] disabled:opacity-40"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  variant = "default",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}) {
  const cls =
    variant === "primary"
      ? "text-[var(--brand-color)] hover:bg-[var(--brand-tint-8)]"
      : variant === "danger"
        ? "text-rose-400 hover:bg-rose-500/10"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]";
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={[
        "yt-transition inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40",
        cls,
      ].join(" ")}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function ThumbSkeleton() {
  return <div className="h-full w-full animate-pulse bg-[var(--bg-elevated)]" />;
}

export const fieldClass =
  "mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[color-mix(in_oklab,var(--brand-color)_45%,var(--border-default))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/15";

export const textareaClass =
  "w-full resize-y rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[color-mix(in_oklab,var(--brand-color)_45%,var(--border-default))] focus:outline-none focus:ring-2 focus:ring-[var(--brand-color)]/15";

export function ModeSegment({
  value,
  onChange,
  disabled,
}: {
  value: "text" | "image";
  onChange: (v: "text" | "image") => void;
  disabled?: boolean;
}) {
  const items: { id: "text" | "image"; label: string; hint: string }[] = [
    { id: "text", label: "文生图", hint: "纯文字描述" },
    { id: "image", label: "图生图", hint: "上传参考图" },
  ];
  return (
    <div
      className="grid grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/80 p-1"
      role="tablist"
      aria-label="生成模式"
    >
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(item.id)}
            className={[
              "yt-transition rounded-[calc(var(--radius-md)-2px)] px-3 py-2 text-left disabled:opacity-40",
              active
                ? "bg-[var(--brand-tint-8)] text-[var(--brand-color)] shadow-sm"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
            ].join(" ")}
          >
            <span className="block text-xs font-semibold">{item.label}</span>
            <span className="mt-0.5 block text-[10px] opacity-80">{item.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ReferenceDropzone({
  paths,
  max,
  onAdd,
  onUseCurrent,
  canUseCurrent,
  disabled,
  children,
}: {
  paths: string[];
  max: number;
  onAdd: () => void;
  onUseCurrent?: () => void;
  canUseCurrent?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[color-mix(in_oklab,var(--brand-color)_25%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-color)_4%,var(--bg-elevated))] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium text-[var(--text-secondary)]">
          参考图 <span className="text-[var(--text-muted)]">({paths.length}/{max})</span>
        </p>
        <div className="flex gap-1.5">
          {canUseCurrent && onUseCurrent ? (
            <button
              type="button"
              disabled={disabled || paths.length >= max}
              onClick={onUseCurrent}
              className="yt-transition rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:border-[var(--brand-color)]/40 hover:text-[var(--brand-color)] disabled:opacity-40"
            >
              用当前预览
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled || paths.length >= max}
            onClick={onAdd}
            className="yt-transition rounded-full border border-[var(--brand-color)]/40 bg-[var(--brand-tint-8)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--brand-color)] hover:bg-[var(--brand-tint-12)] disabled:opacity-40"
          >
            + 添加
          </button>
        </div>
      </div>
      {paths.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">{children}</div>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
          支持 PNG / JPG / WebP，单张 ≤ 10MB，最多 {max} 张。可描述如何修改参考图。
        </p>
      )}
    </div>
  );
}

export const studioStageClass =
  "relative overflow-hidden rounded-xl border border-[color-mix(in_oklab,var(--brand-color)_12%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--brand-color)_3%,var(--bg-surface))]";

