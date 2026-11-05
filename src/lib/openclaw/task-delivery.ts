/**
 * YunTuAI × OpenClaw 任务交付：发送轮次结束后的产出回填与收尾说明。
 * 目标：用户感知「发任务 → 办事 → 交结果」，而不是裸 OpenClaw 超时文案。
 */

import { chatScanNewOutputFiles } from "../chat/chat-files-bridge";
import { isTauriRuntime } from "../tauri-env";
import type { PipelineStep } from "../../types/pipeline-step";
import type { WorkspaceArtifact } from "./workspace-artifacts";
import {
  acceptanceHeadline,
  buildAcceptanceChecklist,
  type AcceptanceCheckItem,
} from "./task-orchestration";
import { mergeArtifacts } from "./workspace-artifacts";
import { useWorkspaceArtifactStore } from "../../stores/workspaceArtifactStore";
import { useStepStore } from "../../stores/stepStore";
import { useUiStore } from "../../stores/uiStore";

export type TaskDeliverySummary = {
  sessionId: string;
  at: string;
  stepTotal: number;
  stepFailed: number;
  stepSuccess: number;
  artifactCount: number;
  artifactPaths: string[];
  outcome: "completed" | "partial" | "failed" | "empty" | "cancelled";
  headline: string;
  detail: string;
  /** 步骤快照（最多 40 条），供切换会话后恢复侧栏时间线 */
  steps?: PipelineStep[];
  /** 验收清单 */
  acceptance?: AcceptanceCheckItem[];
  acceptanceHeadline?: string;
};

const summariesBySession: Record<string, TaskDeliverySummary> = {};
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getTaskDeliverySummary(sessionId: string | null): TaskDeliverySummary | null {
  if (!sessionId) return null;
  return summariesBySession[sessionId] ?? null;
}

export function subscribeTaskDelivery(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearTaskDeliverySummary(sessionId: string): void {
  if (!summariesBySession[sessionId]) return;
  delete summariesBySession[sessionId];
  notify();
}

/** 登出 / 断线：释放跨会话交付缓存，避免长期驻留内存。 */
export function resetTaskDeliveryState(): void {
  for (const k of Object.keys(summariesBySession)) {
    delete summariesBySession[k];
  }
  notify();
}

/** 从持久化 outcome 恢复侧栏摘要（及步骤时间线）。 */
export function hydrateTaskDeliverySummary(summary: TaskDeliverySummary): void {
  if (!summary.sessionId) return;
  summariesBySession[summary.sessionId] = summary;
  notify();
  if (summary.steps?.length) {
    useStepStore.getState().replaceSteps(summary.steps);
  }
}

export function parseTaskOutcomeJson(raw: string | null | undefined): TaskDeliverySummary | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Partial<TaskDeliverySummary>;
    if (!o || typeof o !== "object" || !o.sessionId || !o.headline) return null;
    return {
      sessionId: String(o.sessionId),
      at: typeof o.at === "string" ? o.at : new Date().toISOString(),
      stepTotal: Number(o.stepTotal) || 0,
      stepFailed: Number(o.stepFailed) || 0,
      stepSuccess: Number(o.stepSuccess) || 0,
      artifactCount: Number(o.artifactCount) || 0,
      artifactPaths: Array.isArray(o.artifactPaths)
        ? o.artifactPaths.filter((p): p is string => typeof p === "string")
        : [],
      outcome:
        o.outcome === "completed" ||
        o.outcome === "partial" ||
        o.outcome === "failed" ||
        o.outcome === "empty" ||
        o.outcome === "cancelled"
          ? o.outcome
          : "empty",
      headline: String(o.headline),
      detail: typeof o.detail === "string" ? o.detail : "",
      steps: Array.isArray(o.steps) ? (o.steps as PipelineStep[]).slice(0, 40) : undefined,
      acceptance: Array.isArray(o.acceptance) ? (o.acceptance as AcceptanceCheckItem[]) : undefined,
      acceptanceHeadline: typeof o.acceptanceHeadline === "string" ? o.acceptanceHeadline : undefined,
    };
  } catch {
    return null;
  }
}

/** 将产出目录新文件并入侧栏工作区产物。 */
export async function scanAndMergeOutputArtifacts(
  sessionId: string,
  sinceMs: number,
): Promise<WorkspaceArtifact[]> {
  if (!isTauriRuntime() || !sessionId || sinceMs <= 0) return [];
  const scanned = await chatScanNewOutputFiles(sinceMs).catch(() => null);
  if (!scanned?.length) return [];

  const at = new Date().toISOString();
  const incoming: WorkspaceArtifact[] = scanned.map((f) => ({
    path: f.path,
    kind: "write" as const,
    toolName: "output-scan",
    at,
  }));

  useWorkspaceArtifactStore.setState((s) => {
    const prev = s.bySession[sessionId] ?? [];
    return {
      bySession: {
        ...s.bySession,
        [sessionId]: mergeArtifacts(prev, incoming),
      },
    };
  });

  return incoming;
}

function summarizeSteps(steps: PipelineStep[]) {
  const stepTotal = steps.length;
  const stepFailed = steps.filter((s) => s.status === "failed").length;
  const stepSuccess = steps.filter((s) => s.status === "success" || s.status === "skipped").length;
  const stepRunning = steps.filter((s) => s.status === "running").length;
  return { stepTotal, stepFailed, stepSuccess, stepRunning };
}

export function buildTaskDeliverySummary(
  sessionId: string,
  steps: PipelineStep[],
  artifacts: WorkspaceArtifact[],
  opts?: {
    hadAssistantText?: boolean;
    cancelled?: boolean;
    cancelReason?: "user" | "timeout" | "disconnect" | "error";
    assistantText?: string;
  },
): TaskDeliverySummary {
  const { stepTotal, stepFailed, stepSuccess, stepRunning } = summarizeSteps(steps);
  const artifactPaths = artifacts.slice(0, 8).map((a) => a.path);
  const artifactCount = artifacts.length;

  let outcome: TaskDeliverySummary["outcome"] = "empty";
  if (opts?.cancelled) outcome = "cancelled";
  else if (stepFailed > 0 && stepSuccess === 0) outcome = "failed";
  else if (stepFailed > 0) outcome = "partial";
  else if (stepSuccess > 0 || artifactCount > 0 || opts?.hadAssistantText) outcome = "completed";
  else if (stepRunning > 0) outcome = "partial";

  const pathPreview =
    artifactPaths.length > 0
      ? artifactPaths.map((p) => `· ${p}`).join("\n")
      : "";

  let headline: string;
  let detail: string;
  switch (outcome) {
    case "cancelled":
      if (opts?.cancelReason === "timeout") {
        headline = "任务执行超时（后台已暂停）";
        detail = [
          stepTotal > 0
            ? `停止前：成功 ${stepSuccess}，失败 ${stepFailed}${stepRunning ? `，进行中 ${stepRunning}` : ""}`
            : "Agent 单轮运行已达时间上限",
          pathPreview || null,
          "请到 output 目录查看已生成文件；点击「重试发送」可续收尾（不会重复保存用户消息）。",
        ]
          .filter(Boolean)
          .join("\n");
      } else if (opts?.cancelReason === "error") {
        headline = "任务执行出错";
        detail = [
          stepTotal > 0
            ? `停止前：成功 ${stepSuccess}，失败 ${stepFailed}${stepRunning ? `，进行中 ${stepRunning}` : ""}`
            : "运行中出现错误（非连接中断）",
          pathPreview || null,
          "可点击「重试发送」继续；若右侧已有产出文件，请先验收。",
        ]
          .filter(Boolean)
          .join("\n");
      } else {
        headline = "任务已取消";
        detail = [
          stepTotal > 0
            ? `停止前：成功 ${stepSuccess}，失败 ${stepFailed}${stepRunning ? `，进行中 ${stepRunning}` : ""}`
            : opts?.cancelReason === "disconnect"
              ? "发送时与本机服务连接中断"
              : "用户停止了本轮执行",
          pathPreview || null,
          "可点击「重跑本任务」继续，或在对话中重试发送。",
        ]
          .filter(Boolean)
          .join("\n");
      }
      break;
    case "completed":
      headline = artifactCount > 0 ? `任务已完成，产出 ${artifactCount} 个文件` : "任务已完成";
      detail = [
        stepTotal > 0 ? `步骤 ${stepSuccess}/${stepTotal} 成功` : null,
        pathPreview || null,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "partial":
      headline = `任务部分完成（失败 ${stepFailed}）`;
      detail = [
        `成功 ${stepSuccess}，失败 ${stepFailed}${stepRunning ? `，仍有 ${stepRunning} 进行中` : ""}`,
        pathPreview || null,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "failed":
      headline = "任务执行失败";
      detail = `共 ${stepTotal} 步，均未成功。请查看任务进度详情后重试。`;
      break;
    default:
      headline = "本轮未检测到工具步骤或产出";
      detail = "若模型仅返回了对话正文，属正常；若期望有文件产出，请检查输出目录与任务说明。";
  }

  const acceptance = buildAcceptanceChecklist(
    {
      sessionId,
      at: new Date().toISOString(),
      stepTotal,
      stepFailed,
      stepSuccess,
      artifactCount,
      artifactPaths,
      outcome,
      headline,
      detail,
    },
    steps,
    { assistantText: opts?.assistantText },
  );

  return {
    sessionId,
    at: new Date().toISOString(),
    stepTotal,
    stepFailed,
    stepSuccess,
    artifactCount,
    artifactPaths,
    outcome,
    headline,
    detail,
    steps: steps.slice(0, 40).map((st) => ({ ...st })),
    acceptance,
    acceptanceHeadline: acceptanceHeadline(acceptance),
  };
}

/**
 * 工具步骤已成功但无助手正文时，写入集成化收尾说明（替代裸「暂未收到正文」）。
 */
export function buildToolOnlyCompletionNotice(summary: TaskDeliverySummary): string {
  const lines = [
    "【任务已执行】本轮主要由工具完成，未返回额外正文说明。",
    "",
    summary.headline,
  ];
  if (summary.detail.trim()) {
    lines.push(summary.detail);
  }
  lines.push("", "可在右侧「任务进度」查看详情；需要补充说明时请直接追问。");
  return lines.join("\n");
}

export function shouldPreferToolOnlyNotice(summary: TaskDeliverySummary): boolean {
  return (
    summary.outcome === "completed" &&
    (summary.stepSuccess > 0 || summary.artifactCount > 0)
  );
}

/**
 * 发送轮次收尾：扫描产出 → 汇总 → 可选 toast。
 * 应在 clear steps 之前调用（会读取当前 stepStore）。
 */
export async function finalizeTaskDelivery(
  sessionId: string,
  sinceMs: number | undefined,
  opts?: {
    hadAssistantText?: boolean;
    toast?: boolean;
    cancelled?: boolean;
    cancelReason?: "user" | "timeout" | "disconnect" | "error";
    assistantText?: string;
  },
): Promise<TaskDeliverySummary> {
  useStepStore
    .getState()
    .finalizeStaleRunningSteps(opts?.cancelled ? "skipped" : "success");
  const steps = useStepStore.getState().steps;

  if (opts?.assistantText?.trim()) {
    const { applyOfficeWriteBackFromAssistant } = await import("../chat/office-write-back");
    await applyOfficeWriteBackFromAssistant(opts.assistantText).catch(() => []);
  }

  if (sinceMs != null && sinceMs > 0) {
    await scanAndMergeOutputArtifacts(sessionId, sinceMs);
  }

  const artifacts = useWorkspaceArtifactStore.getState().bySession[sessionId] ?? [];
  const summary = buildTaskDeliverySummary(sessionId, steps, artifacts, {
    hadAssistantText: opts?.hadAssistantText,
    cancelled: opts?.cancelled,
    cancelReason: opts?.cancelReason,
    assistantText: opts?.assistantText,
  });
  summariesBySession[sessionId] = summary;
  notify();

  if (opts?.toast !== false && summary.outcome === "completed" && summary.artifactCount > 0) {
    const { chatGetOutputDir } = await import("../chat/chat-files-bridge");
    const { revealPathInOs } = await import("./os-open");
    useUiStore.getState().showToast(summary.headline, "success", {
      label: "打开产出文件夹",
      onClick: () => {
        void chatGetOutputDir().then((dir) => {
          if (dir?.trim()) void revealPathInOs(dir);
        });
      },
    });
  }

  try {
    const { useTaskStore } = await import("../../stores/taskStore");
    await useTaskStore.getState().completeActiveTask(sessionId, summary);
  } catch {
    /* 持久化失败不阻断交付 UX */
  }

  return summary;
}
