import { memo, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  APPROVAL_SNOOZE_MS,
  computeApprovalSnoozeUntil,
  defaultDecisions,
  type ExecApprovalDecision,
} from "../../lib/openclaw/exec-approval";
import { describeExecApproval } from "../../lib/openclaw/exec-approval-copy";
import { useExecApprovalStore } from "../../stores/execApprovalStore";

const DECISION_LABEL: Record<ExecApprovalDecision, string> = {
  "allow-once": "允许一次",
  "allow-always": "始终允许",
  deny: "拒绝",
};

export const ExecApprovalDialog = memo(function ExecApprovalDialog() {
  const queue = useExecApprovalStore((s) => s.queue);
  const busy = useExecApprovalStore((s) => s.busy);
  const error = useExecApprovalStore((s) => s.error);
  const resolve = useExecApprovalStore((s) => s.resolve);
  const defer = useExecApprovalStore((s) => s.defer);
  const clearExpiredSnoozes = useExecApprovalStore((s) => s.clearExpiredSnoozes);
  const selectActive = useExecApprovalStore((s) => s.selectActive);
  const [showTech, setShowTech] = useState(false);

  useEffect(() => {
    const tick = () => clearExpiredSnoozes();
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [clearExpiredSnoozes]);

  const active = selectActive();
  const open = Boolean(active);
  const snoozedCount = queue.length - (active ? 1 : 0);
  const decisions = active ? defaultDecisions(active) : [];
  const copy = useMemo(() => (active ? describeExecApproval(active) : null), [active]);

  useEffect(() => {
    setShowTech(false);
  }, [active?.id]);

  const queueSuffix = queue.length > 1 ? `（还有 ${queue.length - 1} 项）` : "";
  const title = copy
    ? `${copy.title}${queueSuffix}`
    : active?.kind === "plugin"
      ? `插件操作待确认${queueSuffix}`
      : `本机操作待确认${queueSuffix}`;

  const canSnooze = active
    ? computeApprovalSnoozeUntil(Date.now(), active.expiresAtMs) != null
    : false;
  const snoozeHintMs = active
    ? (computeApprovalSnoozeUntil(Date.now(), active.expiresAtMs) ?? 0) - Date.now()
    : APPROVAL_SNOOZE_MS;
  const snoozeMinutes = Math.max(1, Math.round(snoozeHintMs / 60_000));

  const confirmLabel = copy?.risky
    ? decisions.includes("allow-once")
      ? "仍要允许一次"
      : "允许"
    : decisions.includes("allow-once")
      ? "允许本次"
      : "允许";

  return (
    <>
      {queue.length > 0 ? (
        <div
          className="fixed inset-x-0 top-3 z-[200] mx-auto max-w-lg px-4"
          role="status"
          aria-live="polite"
        >
          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-surface)] px-4 py-2 text-center text-xs text-[var(--warn-text)] shadow-lg">
            {open
              ? `Agent 等待你确认 ${queue.length} 项操作`
              : `还有 ${queue.length} 项待确认（${snoozedCount} 项已稍后，到期会再提醒）`}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={open}
        title={title}
        titleId="yuntu-exec-approval-title"
        variant={copy?.risky ? "danger" : "default"}
        confirmLabel={confirmLabel}
        cancelLabel="稍后"
        hideCancel={!canSnooze}
        hideConfirm={!decisions.includes("allow-once")}
        confirmDisabled={busy}
        confirmLoading={busy}
        dismissible={canSnooze}
        onClose={() => {
          if (active) defer(active.id);
        }}
        onConfirm={() => {
          if (active) void resolve(active.id, "allow-once");
        }}
      >
        {active && copy ? (
          <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
            <p className="font-medium text-[var(--text-primary)]">{copy.summary}</p>
            {copy.detail ? <p className="text-xs">{copy.detail}</p> : null}
            {active.kind === "plugin" && active.pluginDescription ? (
              <p className="text-xs">{active.pluginDescription}</p>
            ) : null}
            {active.kind === "exec" ? (
              <button
                type="button"
                className="text-xs text-[var(--brand-color)] hover:underline"
                onClick={() => setShowTech((v) => !v)}
              >
                {showTech ? "收起技术细节" : "查看技术细节"}
              </button>
            ) : null}
            {showTech && active.kind === "exec" ? (
              <pre className="max-h-48 overflow-auto rounded-lg bg-black/25 p-3 font-mono text-[11px] leading-relaxed text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {active.request.command}
              </pre>
            ) : null}
            {showTech && active.request.cwd ? (
              <p className="text-xs">
                工作目录：<code className="rounded bg-black/15 px-1">{active.request.cwd}</code>
              </p>
            ) : null}
            <p className="text-xs text-[var(--text-tertiary)]">
              {canSnooze
                ? `「稍后」不会拒绝；约 ${snoozeMinutes} 分钟内会再次提醒（不会拖过审批过期）。若要阻止请选择「拒绝」。`
                : "此项即将过期，无法稍后。请立即允许或拒绝。"}
            </p>
            {error ? <p className="text-xs text-[var(--color-error)]">{error}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {decisions.includes("allow-always") ? (
                <button
                  type="button"
                  disabled={busy}
                  className="yt-btn-svc"
                  onClick={() => void resolve(active.id, "allow-always")}
                >
                  {DECISION_LABEL["allow-always"]}
                </button>
              ) : null}
              {decisions.includes("deny") ? (
                <button
                  type="button"
                  disabled={busy}
                  className="yt-btn-svc border-[var(--color-error)]/40 text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]"
                  onClick={() => void resolve(active.id, "deny")}
                >
                  {DECISION_LABEL.deny}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </ConfirmDialog>
    </>
  );
});
