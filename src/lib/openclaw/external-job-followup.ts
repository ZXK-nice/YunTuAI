/**
 * 外部长任务（如 YunTu AOS publish job）轮询与终态自主回复。
 */

import {
  extractTrackedJobIds,
  hasTerminalJobReport,
  isInterimAssistantStatus,
} from "../chat/deliverable-content";
import {
  fetchAosHealth,
  fetchAosJob,
  formatAosJobReport,
  isAosJobTerminal,
  type AosJobSummary,
} from "../aos/aos-api";

const POLL_MS = 5_000;
const MAX_POLL_MS = 2 * 60 * 60 * 1000;

const activePolls = new Map<string, AbortController>();

function pollKey(sessionId: string, jobId: string): string {
  return `${sessionId}:${jobId}`;
}

export type ExternalJobFollowUpDeps = {
  isConnected: () => boolean;
  showToast: (message: string, kind: "info" | "success" | "error" | "warning") => void;
  openSidePanel?: () => void;
  appendBlock: (text: string) => Promise<void>;
};

export function shouldScheduleExternalJobFollowUp(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text) return false;
  if (hasTerminalJobReport(text)) return false;
  const jobIds = extractTrackedJobIds(text);
  if (jobIds.length === 0) return false;
  return isInterimAssistantStatus(text) || /job_id|入队|enqueue/i.test(text);
}

export function scheduleExternalJobFollowUp(
  sessionId: string,
  sendId: string,
  assistantText: string,
  parentLabel: string,
  deps: ExternalJobFollowUpDeps,
): void {
  if (!shouldScheduleExternalJobFollowUp(assistantText)) return;

  const jobIds = extractTrackedJobIds(assistantText);
  if (jobIds.length === 0) return;

  void (async () => {
    const { useExternalJobWatchStore } = await import("../../stores/externalJobWatchStore");
    const alive = await fetchAosHealth();
    if (!alive) {
      deps.showToast("AOS 服务未就绪，无法自动追踪任务进度", "warning");
      return;
    }

    deps.openSidePanel?.();
    deps.showToast(`正在后台追踪 ${jobIds.length} 个 AOS 任务，完成后将自动汇报`, "info");

    for (const jobId of jobIds) {
      const key = pollKey(sessionId, jobId);
      if (activePolls.has(key)) continue;

      const runId = useExternalJobWatchStore.getState().beginWatch({
        id: `aos-${sendId}-${jobId.slice(0, 8)}`,
        sessionId,
        parentSendId: sendId,
        parentLabel: parentLabel.slice(0, 32) || "AOS 发布",
        jobId,
      });

      const ac = new AbortController();
      activePolls.set(key, ac);
      void pollJobUntilTerminal(sessionId, jobId, runId, ac.signal, deps).finally(() => {
        activePolls.delete(key);
      });
    }
  })();
}

async function pollJobUntilTerminal(
  sessionId: string,
  jobId: string,
  runId: string,
  signal: AbortSignal,
  deps: ExternalJobFollowUpDeps,
): Promise<void> {
  const { useExternalJobWatchStore } = await import("../../stores/externalJobWatchStore");
  const started = Date.now();

  while (!signal.aborted && Date.now() - started < MAX_POLL_MS) {
    const job = await fetchAosJob(jobId);
    if (job) {
      useExternalJobWatchStore.getState().patchWatch(runId, {
        status: job.status ?? "unknown",
        completedItems: job.completedItems,
        failedItems: job.failedItems,
        totalItems: job.totalItems,
        lastPollAt: new Date().toISOString(),
      });

      if (isAosJobTerminal(job.status) || job.terminal) {
        await deliverTerminalJob(sessionId, job, deps);
        useExternalJobWatchStore.getState().finishWatch(runId, job.status ?? "done");
        return;
      }
    }

    await sleep(POLL_MS, signal);
  }

  useExternalJobWatchStore.getState().finishWatch(runId, "timeout");
  if (!signal.aborted) {
    deps.showToast(`AOS 任务 ${jobId.slice(0, 8)}… 追踪超时，请手动查询状态`, "warning");
  }
}

async function deliverTerminalJob(
  sessionId: string,
  job: AosJobSummary,
  deps: ExternalJobFollowUpDeps,
): Promise<void> {
  const report = formatAosJobReport(job);
  const msgs = (await import("../../stores/sessionStore")).useSessionStore.getState()
    .messagesBySession[sessionId];
  const duplicate = msgs?.some(
    (m) =>
      m.role === "assistant" &&
      m.content.includes(job.jobId) &&
      m.content.includes("【AOS 任务终态汇报】"),
  );
  if (duplicate) return;

  await deps.appendBlock(report);
  const ok = job.status === "completed";
  deps.showToast(
    ok ? `AOS 任务已完成（${job.completedItems ?? 0} 条）` : `AOS 任务结束：${job.status}`,
    ok ? "success" : "warning",
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(() => resolve(), ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export function cancelExternalJobFollowUps(sessionId: string): void {
  for (const [key, ac] of activePolls) {
    if (key.startsWith(`${sessionId}:`)) {
      ac.abort();
      activePolls.delete(key);
    }
  }
}

/** 测试用：清空轮询表 */
export function resetExternalJobFollowUpForTests(): void {
  for (const ac of activePolls.values()) ac.abort();
  activePolls.clear();
}
