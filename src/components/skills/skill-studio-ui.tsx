import { memo, useState, type ReactNode } from "react";



export const WIZARD_STEPS = [

  { id: 1 as const, label: "身份", hint: "行业与岗位" },

  { id: 2 as const, label: "场景", hint: "高频办事" },

  { id: 3 as const, label: "沟通", hint: "习惯澄清" },

  { id: 4 as const, label: "预览", hint: "生成安装" },

];



export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];



const STEP_SUBTITLES: Record<WizardStepId, string> = {

  1: "选择你的行业与岗位，或自定义身份",

  2: "勾选日常办事场景，可多选",

  3: "回答几个问题，技能会更贴身",

  4: "预览 SKILL.md 并安装到工作区",

};



export const INDUSTRY_GLYPH: Record<string, string> = {

  "smart-manufacturing": "厂",

  "foreign-trade": "贸",

  sales: "售",

  "legal-compliance": "法",

  "finance-tax": "财",

  education: "教",

  "content-marketing": "营",

  "admin-hr": "行",

  "real-estate": "房",

  consulting: "咨",

  "customer-service": "服",

  logistics: "仓",

  "design-creative": "设",

  "software-rd": "码",

  custom: "✦",

};



export function industryGlyph(id: string): string {

  return INDUSTRY_GLYPH[id] ?? "·";

}



export function IconSpark({ className }: { className?: string }) {

  return (

    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>

      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />

      <path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1 3 1z" />

    </svg>

  );

}



const panelGlass =

  "rounded-xl border border-[color-mix(in_oklab,var(--brand-color)_18%,var(--border-subtle))] bg-[var(--surface-glass)] shadow-[0_1px_0_color-mix(in_oklab,var(--brand-color)_6%,transparent)]";



export const StudioGatewayBadge = memo(function StudioGatewayBadge({

  gatewayOnline,

  compact,

}: {

  gatewayOnline: boolean;

  compact?: boolean;

}) {

  return (

    <span

      className={[

        "inline-flex items-center gap-1.5 rounded-full border text-[10px] font-medium",

        compact ? "px-2 py-0.5" : "px-2.5 py-1",

        gatewayOnline

          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"

          : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",

      ].join(" ")}

    >

      <span className={["h-1.5 w-1.5 rounded-full", gatewayOnline ? "bg-emerald-500" : "bg-[var(--text-tertiary)]"].join(" ")} />

      {gatewayOnline ? "智能生成" : "离线草稿"}

    </span>

  );

});



export const StudioSidebar = memo(function StudioSidebar({

  step,

  gatewayOnline,

  onStepClick,

  contextLabel,

  scenarioCount,

  draftDirName,

}: {

  step: WizardStepId;

  gatewayOnline: boolean;

  onStepClick?: (target: WizardStepId) => void;

  contextLabel?: string | null;

  scenarioCount?: number;

  draftDirName?: string | null;

}) {

  return (

    <div className={`${panelGlass} p-4`}>

      <div className="flex items-start gap-3">

        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-tint-8)] text-[var(--brand-color)]">

          <IconSpark className="h-4 w-4" />

        </div>

        <div className="min-w-0 flex-1">

          <h1 className="text-sm font-semibold text-[var(--text-primary)]">技能工坊</h1>

          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">

            四步生成专属办事技能

          </p>

        </div>

      </div>



      <div className="mt-3">

        <StudioGatewayBadge gatewayOnline={gatewayOnline} />

      </div>



      <nav aria-label="技能工坊步骤" className="mt-5">

        <ol className="flex flex-col">

          {WIZARD_STEPS.map((s, i) => {

            const done = step > s.id;

            const active = step === s.id;

            const clickable = done && onStepClick;

            return (

              <li key={s.id} className="flex gap-3">

                <div className="flex flex-col items-center">

                  <button

                    type="button"

                    disabled={!clickable}

                    onClick={() => clickable && onStepClick?.(s.id)}

                    className={[

                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",

                      done

                        ? "bg-[var(--brand-color)] text-white"

                        : active

                          ? "bg-[var(--brand-tint-12)] text-[var(--brand-color)] ring-2 ring-[var(--brand-color)]/20"

                          : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",

                      clickable ? "cursor-pointer hover:opacity-90" : "cursor-default",

                    ].join(" ")}

                    aria-current={active ? "step" : undefined}

                  >

                    {done ? "✓" : s.id}

                  </button>

                  {i < WIZARD_STEPS.length - 1 && (

                    <div

                      className={[

                        "my-1 w-px min-h-[1.25rem] flex-1",

                        done ? "bg-[var(--brand-color)]/40" : "bg-[var(--border-subtle)]",

                      ].join(" ")}

                    />

                  )}

                </div>

                <div className={i < WIZARD_STEPS.length - 1 ? "pb-4" : ""}>

                  <div

                    className={[

                      "text-xs leading-none",

                      active ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-secondary)]",

                    ].join(" ")}

                  >

                    {s.label}

                  </div>

                  <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">{s.hint}</div>

                </div>

              </li>

            );

          })}

        </ol>

      </nav>



      {(contextLabel || draftDirName) && (

        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 p-3">

          <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">当前选择</div>

          {contextLabel && (

            <p className="mt-1.5 text-xs font-medium leading-snug text-[var(--text-primary)]">{contextLabel}</p>

          )}

          {typeof scenarioCount === "number" && scenarioCount > 0 && (

            <p className="mt-1 text-[10px] text-[var(--text-secondary)]">已选 {scenarioCount} 个场景</p>

          )}

          {draftDirName && (

            <p className="mt-1.5 font-mono text-[10px] text-[var(--text-tertiary)]">{draftDirName}</p>

          )}

        </div>

      )}

    </div>

  );

});



/** Horizontal stepper for narrow screens */

export const WizardStepper = memo(function WizardStepper({

  step,

  onStepClick,

}: {

  step: WizardStepId;

  onStepClick?: (target: WizardStepId) => void;

}) {

  return (

    <nav aria-label="技能工坊步骤" className={`${panelGlass} p-3 lg:hidden`}>

      <ol className="grid grid-cols-4 gap-1">

        {WIZARD_STEPS.map((s) => {

          const done = step > s.id;

          const active = step === s.id;

          const clickable = done && onStepClick;

          return (

            <li key={s.id} className="flex min-w-0 flex-col items-center gap-1.5">

              <button

                type="button"

                disabled={!clickable}

                onClick={() => clickable && onStepClick?.(s.id)}

                className={[

                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors",

                  done

                    ? "bg-[var(--brand-color)] text-white"

                    : active

                      ? "bg-[var(--brand-tint-12)] text-[var(--brand-color)] ring-2 ring-[var(--brand-color)]/25"

                      : "bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",

                  clickable ? "cursor-pointer hover:opacity-90" : "cursor-default",

                ].join(" ")}

                aria-current={active ? "step" : undefined}

              >

                {done ? "✓" : s.id}

              </button>

              <span

                className={[

                  "w-full truncate text-center text-[10px]",

                  active ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",

                ].join(" ")}

              >

                {s.label}

              </span>

            </li>

          );

        })}

      </ol>

    </nav>

  );

});



export const StudioShell = memo(function StudioShell({

  step,

  gatewayOnline,

  onStepClick,

  contextLabel,

  scenarioCount,

  draftDirName,

  children,

}: {

  step: WizardStepId;

  gatewayOnline: boolean;

  onStepClick?: (target: WizardStepId) => void;

  contextLabel?: string | null;

  scenarioCount?: number;

  draftDirName?: string | null;

  children: ReactNode;

}) {

  return (

    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">

      <div className="hidden shrink-0 lg:block lg:w-56 xl:w-60 lg:sticky lg:top-4">

        <StudioSidebar

          step={step}

          gatewayOnline={gatewayOnline}

          onStepClick={onStepClick}

          contextLabel={contextLabel}

          scenarioCount={scenarioCount}

          draftDirName={draftDirName}

        />

      </div>

      <div className="min-w-0 flex-1">

        <WizardStepper step={step} onStepClick={onStepClick} />

        <div key={step} className="mt-4 yt-panel-fade-in">

          {children}

        </div>

      </div>

    </div>

  );

});



export const StudioStepHeader = memo(function StudioStepHeader({
  step,
  gatewayOnline,
}: {
  step: WizardStepId;
  gatewayOnline: boolean;
}) {
  const meta = WIZARD_STEPS.find((s) => s.id === step);
  if (!meta) return null;
  return (
    <header className="mb-5 border-b border-[var(--border-subtle)] pb-4 lg:hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          第 {step} 步 · {meta.label}
        </h2>
        <StudioGatewayBadge gatewayOnline={gatewayOnline} compact />
      </div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{STEP_SUBTITLES[step]}</p>
    </header>
  );
});

export const StudioSection = memo(function StudioSection({

  title,

  subtitle,

  children,

}: {

  title: string;

  subtitle?: string;

  children: ReactNode;

}) {

  return (

    <section className="flex flex-col gap-3">

      <div>

        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>

        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{subtitle}</p>}

      </div>

      {children}

    </section>

  );

});



export const StudioPanel = memo(function StudioPanel({ children }: { children: ReactNode }) {

  return <div className={`${panelGlass} p-4 sm:p-5 lg:p-6`}>{children}</div>;

});



export const StudioChip = memo(function StudioChip({

  selected,

  onClick,

  children,

}: {

  selected: boolean;

  onClick: () => void;

  children: ReactNode;

}) {

  return (

    <button

      type="button"

      onClick={onClick}

      className={[

        "rounded-full px-3 py-1.5 text-sm transition-all",

        selected

          ? "bg-[var(--brand-color)] text-white shadow-sm"

          : "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[color-mix(in_oklab,var(--brand-color)_25%,var(--border-subtle))] hover:text-[var(--brand-color)]",

      ].join(" ")}

    >

      {children}

    </button>

  );

});



export const StudioIndustryCard = memo(function StudioIndustryCard({

  label,

  description,

  glyph,

  roleCount,

  selected,

  highlight,

  onClick,

}: {

  label: string;

  description: string;

  glyph?: string;

  roleCount?: number;

  selected: boolean;

  highlight?: boolean;

  onClick: () => void;

}) {

  return (

    <button

      type="button"

      onClick={onClick}

      className={[

        "group relative flex gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-left transition-all",

        selected

          ? "border-[var(--brand-color)] bg-[var(--brand-tint-8)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--brand-color)_40%,transparent)]"

          : highlight

            ? "border-dashed border-[color-mix(in_oklab,var(--brand-color)_35%,var(--border-subtle))] hover:border-[var(--brand-color)] hover:bg-[var(--brand-tint-8)]/40"

            : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 hover:border-[color-mix(in_oklab,var(--brand-color)_22%,var(--border-subtle))] hover:bg-[var(--bg-elevated)]",

      ].join(" ")}

    >

      {glyph && (

        <span

          className={[

            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-sm font-semibold transition-colors",

            selected

              ? "bg-[var(--brand-color)] text-white"

              : "bg-[var(--surface-2)] text-[var(--brand-color)] group-hover:bg-[var(--brand-tint-8)]",

          ].join(" ")}

        >

          {glyph}

        </span>

      )}

      <span className="min-w-0 flex-1">

        <span className="flex items-start justify-between gap-2">

          <span className="font-medium text-[var(--text-primary)]">{label}</span>

          {selected && (

            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-color)] text-[10px] text-white">

              ✓

            </span>

          )}

        </span>

        <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">{description}</span>

        {typeof roleCount === "number" && roleCount > 0 && (

          <span className="mt-1.5 inline-block text-[10px] text-[var(--text-tertiary)]">{roleCount} 个岗位</span>

        )}

      </span>

    </button>

  );

});



export const StudioScenarioCard = memo(function StudioScenarioCard({

  label,

  summary,

  checked,

  onToggle,

}: {

  label: string;

  summary: string;

  checked: boolean;

  onToggle: () => void;

}) {

  return (

    <button

      type="button"

      onClick={onToggle}

      className={[

        "flex w-full items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-left transition-all",

        checked

          ? "border-[var(--brand-color)] bg-[var(--brand-tint-8)]"

          : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 hover:border-[color-mix(in_oklab,var(--brand-color)_22%,var(--border-subtle))]",

      ].join(" ")}

    >

      <span

        className={[

          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]",

          checked

            ? "border-[var(--brand-color)] bg-[var(--brand-color)] text-white"

            : "border-[var(--border-subtle)] bg-[var(--surface-1)]",

        ].join(" ")}

        aria-hidden

      >

        {checked ? "✓" : ""}

      </span>

      <span className="min-w-0">

        <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>

        <span className="mt-0.5 block text-xs leading-relaxed text-[var(--text-secondary)]">{summary}</span>

      </span>

    </button>

  );

});



export const StudioField = memo(function StudioField({

  label,

  htmlFor,

  children,

}: {

  label: string;

  htmlFor?: string;

  children: ReactNode;

}) {

  return (

    <label className="block" htmlFor={htmlFor}>

      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">{label}</span>

      {children}

    </label>

  );

});



export const studioInputClass =

  "w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[color-mix(in_oklab,var(--brand-color)_40%,var(--border-subtle))] focus:ring-2 focus:ring-[var(--brand-color)]/12";



export const StudioFooter = memo(function StudioFooter({

  onBack,

  backLabel = "上一步",

  hint,

  children,

}: {

  onBack?: () => void;

  backLabel?: string;

  hint?: string;

  children?: ReactNode;

}) {

  return (

    <div className="mt-6 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">

      {onBack ? (

        <button type="button" onClick={onBack} className="yt-btn-ghost yt-transition rounded-[var(--radius-md)] px-4 py-2 text-sm">

          {backLabel}

        </button>

      ) : (

        <span />

      )}

      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">

        {hint && <span className="text-xs text-[var(--text-tertiary)] sm:mr-2">{hint}</span>}

        {children}

      </div>

    </div>

  );

});



export const StudioPrimaryButton = memo(function StudioPrimaryButton({

  disabled,

  onClick,

  children,

}: {

  disabled?: boolean;

  onClick: () => void;

  children: ReactNode;

}) {

  return (

    <button

      type="button"

      disabled={disabled}

      onClick={onClick}

      className="yt-btn-primary yt-transition rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium disabled:opacity-40"

    >

      {children}

    </button>

  );

});



export const StudioGhostButton = memo(function StudioGhostButton({

  disabled,

  onClick,

  children,

}: {

  disabled?: boolean;

  onClick: () => void;

  children: ReactNode;

}) {

  return (

    <button

      type="button"

      disabled={disabled}

      onClick={onClick}

      className="yt-btn-svc yt-transition rounded-[var(--radius-md)] px-3 py-2 text-sm disabled:opacity-40"

    >

      {children}

    </button>

  );

});



export const StudioBadge = memo(function StudioBadge({ children }: { children: ReactNode }) {

  return (

    <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">

      {children}

    </span>

  );

});



export const CollapsibleSection = memo(function CollapsibleSection({

  title,

  subtitle,

  defaultOpen = false,

  children,

}: {

  title: string;

  subtitle?: string;

  defaultOpen?: boolean;

  children: ReactNode;

}) {

  const [open, setOpen] = useState(defaultOpen);

  return (

    <section className={`${panelGlass} p-4 sm:p-5`}>

      <button

        type="button"

        onClick={() => setOpen((v) => !v)}

        className="flex w-full items-center justify-between gap-3 text-left"

      >

        <div>

          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>

          {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>}

        </div>

        <span

          className={[

            "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",

            open

              ? "border-[var(--brand-color)]/30 bg-[var(--brand-tint-8)] text-[var(--brand-color)]"

              : "border-[var(--border-subtle)] text-[var(--text-tertiary)]",

          ].join(" ")}

        >

          {open ? "收起" : "展开"}

        </span>

      </button>

      {open && <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">{children}</div>}

    </section>

  );

});


