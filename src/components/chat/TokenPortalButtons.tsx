import { memo, type ReactNode } from "react";
import { INTERNAL_PROFILE_ID } from "../../lib/distribution-profile";
import { openBillingPortal } from "../../lib/billing-portal";

function IconTokenQuery({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-6" />
      <path d="M3 20h18" />
    </svg>
  );
}

function IconTokenRecharge({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 7H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
      <path d="M3 10h20" />
      <path d="M16 14h4" />
      <path d="M18 12v4" />
    </svg>
  );
}

const BTN_CLASS =
  "yt-press yt-transition group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--brand-color)_22%,var(--border-subtle))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--brand-color)_10%,var(--bg-elevated)),var(--bg-elevated))] text-[var(--brand-color)] shadow-[0_1px_0_color-mix(in_oklab,var(--brand-color)_12%,transparent)] hover:border-[color-mix(in_oklab,var(--brand-color)_45%,var(--border-subtle))] hover:bg-[var(--brand-surface-select)] hover:shadow-[0_2px_8px_color-mix(in_oklab,var(--brand-color)_14%,transparent)]";

function PortalButton({
  icon,
  label,
  onClick,
  compact,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[BTN_CLASS, compact ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs font-medium"].join(" ")}
    >
      <span
        className={[
          "flex items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--brand-color)_14%,transparent)] text-[var(--brand-color)] transition-colors group-hover:bg-[color-mix(in_oklab,var(--brand-color)_22%,transparent)]",
          compact ? "h-4 w-4" : "h-5 w-5",
        ].join(" ")}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

type Props = {
  profileId?: string | null;
  compact?: boolean;
  className?: string;
};

/** token 充值 / 余量查询（内部版跳转 MiMo 控制台，中转站跳转运营门户） */
export const TokenPortalButtons = memo(function TokenPortalButtons({
  profileId = INTERNAL_PROFILE_ID,
  compact = false,
  className = "",
}: Props) {
  return (
    <div className={["flex shrink-0 items-center gap-1.5", className].join(" ")}>
      <PortalButton
        compact={compact}
        icon={<IconTokenRecharge className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />}
        label="token充值"
        onClick={() => void openBillingPortal(profileId, "recharge")}
      />
      <PortalButton
        compact={compact}
        icon={<IconTokenQuery className={compact ? "h-2.5 w-2.5" : "h-3 w-3"} />}
        label="余量查询"
        onClick={() => void openBillingPortal(profileId, "balance")}
      />
    </div>
  );
});
