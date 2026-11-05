import { memo } from "react";
import { useAppLogo } from "../../hooks/useAppLogo";
import { useServiceReadinessProgress } from "../../hooks/useServiceReadinessProgress";
import { PRODUCT_NAME } from "../../lib/product-brand";
import type { GatewayLifecyclePhase } from "../../lib/openclaw/gateway-lifecycle";
import type { ProvisionSnapshot } from "../../lib/openclaw/provision-bridge";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import {
  READINESS_DONE_HINT,
  READINESS_MAIN_TITLE,
  READINESS_TIME_HINT,
  sanitizeReadinessDetail,
  userLifecyclePhaseLabel,
  userProvisionPhaseLabel,
} from "../../lib/product/readiness-copy";

const LIFECYCLE_LABEL: Record<GatewayLifecyclePhase, string> = {
  preparing: userLifecyclePhaseLabel("preparing"),
  starting: userLifecyclePhaseLabel("starting"),
  healthy: userLifecyclePhaseLabel("healthy"),
  degraded: userLifecyclePhaseLabel("degraded"),
  failed: userLifecyclePhaseLabel("failed"),
};

type Props =
  | {
      mode: "provision";
      snapshot: ProvisionSnapshot;
      onRetry: () => void;
      canEnterOffline?: boolean;
      onEnterOffline?: () => void;
    }
  | {
      mode: "connect";
      label: string;
      error?: string | null;
      onRetry?: () => void;
      canEnterOffline?: boolean;
      onEnterOffline?: () => void;
    }
  | {
      mode: "startup";
      detail: string;
      error?: string | null;
      onRetry?: () => void;
      /** 登录后连接阶段：合并 lifecycle / provision / 连接管线进度 */
      liveProgress?: boolean;
      canEnterOffline?: boolean;
      onEnterOffline?: () => void;
    };

export function ServiceReadinessScreen(props: Props) {
  const logoSrc = useAppLogo();
  const progressEnabled =
    props.mode === "connect" ||
    (props.mode === "startup" && Boolean(props.liveProgress));
  const progress = useServiceReadinessProgress(progressEnabled);

  if (props.mode === "startup") {
    const { detail, error, onRetry, liveProgress, canEnterOffline, onEnterOffline } = props;
    const phaseLabel = liveProgress
      ? progress.lifecycle?.phase === "healthy"
        ? userLifecyclePhaseLabel("healthy")
        : userProvisionPhaseLabel(
            progress.provision?.phase ?? progress.lifecycle?.phase ?? "prepare",
            progress.combinedPercent,
          )
      : userProvisionPhaseLabel("prepare", 8);
    const percent = liveProgress ? progress.combinedPercent : 8;
    const message = liveProgress
      ? sanitizeReadinessDetail(progress.detail || detail)
      : sanitizeReadinessDetail(detail);
    const running = liveProgress
      ? progress.lifecycle?.phase !== "healthy" && progress.lifecycle?.phase !== "failed"
      : true;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-4 text-[var(--text-primary)]">
        <div className="w-full max-w-md">
          <Header
            logoSrc={logoSrc}
            title={READINESS_MAIN_TITLE}
            subtitle={`${READINESS_TIME_HINT} · ${PRODUCT_NAME}`}
          />
          <ProgressCard
            phaseLabel={phaseLabel}
            percent={percent}
            running={running}
            message={sanitizeUserFacingCopy(message)}
            error={error ? sanitizeUserFacingCopy(error) : null}
            onRetry={onRetry}
            canEnterOffline={canEnterOffline}
            onEnterOffline={onEnterOffline}
          />
          <p className="mt-4 text-center text-[10px] leading-relaxed text-[var(--text-muted)]">
            {READINESS_DONE_HINT}
          </p>
        </div>
      </div>
    );
  }

  if (props.mode === "provision") {
    const { snapshot, onRetry, canEnterOffline, onEnterOffline } = props;
    const { percent, message, phase, running, error } = snapshot;
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-4 text-[var(--text-primary)]">
        <div className="w-full max-w-md">
          <Header
            logoSrc={logoSrc}
            title={READINESS_MAIN_TITLE}
            subtitle={`${READINESS_TIME_HINT} · ${PRODUCT_NAME}`}
          />
          <ProgressCard
            phaseLabel={userProvisionPhaseLabel(phase, percent)}
            percent={percent}
            running={running}
            message={sanitizeReadinessDetail(message) || (running ? "正在配置办公能力…" : "等待开始…")}
            error={error ? sanitizeUserFacingCopy(error) : null}
            onRetry={onRetry}
            canEnterOffline={canEnterOffline}
            onEnterOffline={onEnterOffline}
          />
          <p className="mt-4 text-center text-[10px] leading-relaxed text-[var(--text-muted)]">
            {READINESS_DONE_HINT}
          </p>
        </div>
      </div>
    );
  }

  const { label, error, onRetry, canEnterOffline, onEnterOffline } = props;
  const phase = progress.lifecycle?.phase ?? "starting";
  const detail = progress.detail || label;
  const percent = progress.combinedPercent;
  const phaseLabel =
    progress.provision &&
    (progress.provision.running || progress.provision.needed || !progress.provision.ready)
      ? userProvisionPhaseLabel(progress.provision.phase, progress.provision.percent)
      : LIFECYCLE_LABEL[phase];

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-4 text-[var(--text-primary)]">
      <div className="w-full max-w-md">
        <Header logoSrc={logoSrc} title={READINESS_MAIN_TITLE} subtitle={PRODUCT_NAME} />
        <ProgressCard
          phaseLabel={phaseLabel}
          percent={percent}
          running={phase !== "healthy" && phase !== "failed"}
          message={sanitizeUserFacingCopy(sanitizeReadinessDetail(detail))}
          error={error ? sanitizeUserFacingCopy(error) : phase === "failed" ? progress.lifecycle?.detail : null}
          onRetry={onRetry}
          canEnterOffline={canEnterOffline}
          onEnterOffline={onEnterOffline}
        />
        <p className="mt-4 text-center text-[10px] leading-relaxed text-[var(--text-muted)]">
          {READINESS_DONE_HINT}
        </p>
      </div>
    </div>
  );
}

const Header = memo(function Header({
  logoSrc,
  title,
  subtitle,
}: {
  logoSrc: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-6 flex flex-col items-center">
      <div className="app-brand-logo-slot app-brand-logo-slot--auth">
        <img
          src={logoSrc}
          alt={PRODUCT_NAME}
          className="app-brand-logo-img select-none"
          draggable={false}
          width={88}
          height={88}
        />
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-1 text-center text-xs text-[var(--text-secondary)]">{subtitle}</p>
    </div>
  );
});

const ProgressCard = memo(function ProgressCard({
  phaseLabel,
  percent,
  running,
  message,
  error,
  onRetry,
  canEnterOffline,
  onEnterOffline,
}: {
  phaseLabel: string;
  percent: number;
  running: boolean;
  message: string;
  error?: string | null;
  onRetry?: () => void;
  canEnterOffline?: boolean;
  onEnterOffline?: () => void;
}) {
  const widthPct = Math.min(100, Math.max(percent, running ? 3 : 0));
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{phaseLabel}</span>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">{percent}%</span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
        <div
          className="h-full w-full origin-left rounded-full bg-gradient-to-r from-[var(--brand-color)] to-[var(--brand-color-end)] transition-transform duration-500 ease-out will-change-transform"
          style={{ transform: `scaleX(${widthPct / 100})` }}
        />
      </div>
      <p className="min-h-[2.5rem] text-xs leading-relaxed text-[var(--text-secondary)]">{message}</p>
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-error)]">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 w-full rounded-lg bg-[var(--brand-color)] py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--brand-color-emphasis)]"
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      {canEnterOffline && onEnterOffline ? (
        <button
          type="button"
          onClick={onEnterOffline}
          className="mt-3 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--brand-color)] hover:text-[var(--brand-color)]"
        >
          先进入界面（离线查看历史）
        </button>
      ) : null}
    </div>
  );
});
