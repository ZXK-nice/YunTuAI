import { memo } from "react";

export const SPLASH_LETTERS = ["Y", "u", "n", "T", "u", "A", "I"] as const;

type ProvisionProgress = {
  phase: string;
  percent: number;
  message: string;
};

type Props = {
  label?: string;
  exiting?: boolean;
  busy?: boolean;
  onSkip?: () => void;
  showSkip?: boolean;
  onRetry?: () => void;
  provision?: ProvisionProgress | null;
};

/** 统一启动 / 加载屏：字母环动画，无 logo 闪屏。 */
export const SplashScreen = memo(function SplashScreen({
  label = "加载中…",
  exiting = false,
  busy,
  onSkip,
  showSkip,
  onRetry,
  provision,
}: Props) {
  const showProgress = provision && (provision.percent > 0 || provision.phase !== "");
  return (
    <div
      className={["yt-splash", exiting ? "yt-splash--exit" : ""].join(" ")}
      role="status"
      aria-live="polite"
      aria-busy={busy}
    >
      <div className="yt-splash-rings" aria-hidden>
        <div className="yt-splash-ring" />
        {SPLASH_LETTERS.map((letter, i) => (
          <span key={i} className="yt-splash-letter">
            {letter}
          </span>
        ))}
      </div>
      <p className="yt-splash-status">{label}</p>

      {showProgress && (
        <div className="mt-5 flex w-56 flex-col items-center gap-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              className="h-full rounded-full bg-[var(--brand-color)] transition-all duration-500 ease-out"
              style={{ width: `${Math.min(100, Math.max(2, provision!.percent))}%` }}
            />
          </div>
          <p className="text-[11px] leading-tight text-[var(--text-muted)]">
            {provision!.message || provision!.phase}
          </p>
        </div>
      )}

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="yt-btn-primary mt-5 px-5 py-2 text-sm"
        >
          重新连接
        </button>
      ) : null}

      {showSkip && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="yt-btn-secondary mt-3 px-5 py-2 text-sm"
        >
          先进入主界面，后台继续连接
        </button>
      )}
    </div>
  );
});
