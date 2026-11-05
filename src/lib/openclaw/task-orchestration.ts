import type { LocalMessageRow } from "../../stores/sessionStore";
import type { PipelineStep, StepStatus } from "../../types/pipeline-step";
import type { TaskDeliverySummary } from "./task-delivery";
import { getGatewayClient } from "./gateway-runtime";
import { buildSessionsSendParams } from "./session-rpc";
import { gatewayCreateRemoteSession } from "../../stores/gatewayStore";
import { pollForNewAssistantAfterSend, fetchAssistantBaseline } from "./chat-history-sync";
import { gatewaySessionDelete } from "./console-control";
import { isParallelSubtaskEnabled } from "../parallel-subtask-prefs";

import type { OfficeAttachmentKind } from "../chat/office-workbench";

export type HeuristicPlanIntent =
  | "document"
  | "data"
  | "research"
  | "communication"
  | "automation"
  | "sensitive"
  | "general";

export type TaskPlanStep = {
  id: string;
  title: string;
  status: StepStatus;
  kind: "plan";
  parallelGroupId?: string;
};

export type AcceptanceCheckItem = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
};

const PLAN_BLOCK_RE = /(?:^|\n)#{1,3}\s*执行计划\s*\n([\s\S]*?)(?:\n#{1,3}\s|\n---\n|$)/i;
const PLAN_LINE_RE = /^\s*(?:\d+[.)、]|[-*•])\s+(.+)$/;

const TASK_PLANNING_HINT = `

---
【云图任务模式】
1. 在脑中或工具侧拆解 2～5 步；**正文勿写长「执行计划」**（步骤见右侧任务进度）。
2. 涉及删除/覆盖/对外发送/安装依赖前，先说明将要做什么；不确定时暂停并向用户确认
3. 逐步调用工具执行，每步失败时尝试替代路径（换文件名、换命令、拆分步骤）
4. 完成后按【云图·回复风格】简短收尾（路径 + 结论），勿重复过程`;

export function shouldEnableTaskOrchestration(
  remotePayload: string,
  opts?: { templateId?: string },
): boolean {
  if (opts?.templateId) return true;
  const t = remotePayload.trim();
  if (t.length >= 100) return true;
  return /帮我|整理|分析|生成|调研|对比|汇总|方案|报告|表格|文档|处理|编写|制作|导出|转换|清洗|合并|拆分|归档|发票|报销|合同|简历|邮件|周报|月报|ppt|excel|word|幻灯片|纪要|审查|核对|批量|自动化/.test(
    t,
  );
}

export function withTaskPlanningHint(remotePayload: string): string {
  if (remotePayload.includes("【云图任务模式】")) return remotePayload;
  return `${remotePayload.trim()}${TASK_PLANNING_HINT}`;
}

export function buildHeuristicTaskPlan(
  userGoal: string,
  opts?: { intent?: HeuristicPlanIntent; officeKinds?: OfficeAttachmentKind[] },
): TaskPlanStep[] {
  const goal = userGoal.trim().slice(0, 200);
  const intent = opts?.intent ?? "general";
  const officeKinds = opts?.officeKinds ?? [];
  const hasSheet = officeKinds.some((k) => k === "spreadsheet" || k === "csv") || /excel|xlsx|csv|表格/.test(goal);

  if (intent === "automation" || /自动化|批处理|定时|脚本|监控/.test(goal)) {
    return [
      { title: "确认输入输出与验收标准", parallel: false },
      { title: "小样本试跑验证", parallel: false },
      { title: "全量执行与日志", parallel: false },
      { title: "交付脚本/清单与产出路径", parallel: false },
    ].map((b, i) => ({
      id: `plan-${i + 1}`,
      title: b.title,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      kind: "plan" as const,
      parallelGroupId: undefined,
    }));
  }

  if (hasSheet || intent === "data") {
    return [
      { title: "读取预提取表格/确认字段", parallel: false },
      { title: "清洗、计算或透视", parallel: false },
      { title: "生成结果文件到 output", parallel: false },
      { title: "自检并汇总结论", parallel: false },
    ].map((b, i) => ({
      id: `plan-${i + 1}`,
      title: b.title,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      kind: "plan" as const,
      parallelGroupId: undefined,
    }));
  }

  if (intent === "document" || officeKinds.some((k) => k === "document" || k === "presentation")) {
    return [
      { title: "读取预提取正文/OCR", parallel: false },
      { title: "按需求改写或汇总", parallel: false },
      { title: "输出 docx/txt 到 output", parallel: false },
      { title: "交付说明", parallel: false },
    ].map((b, i) => ({
      id: `plan-${i + 1}`,
      title: b.title,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      kind: "plan" as const,
      parallelGroupId: undefined,
    }));
  }

  if (/对比|调研|多个|分别/.test(goal)) {
    return [
      { title: "理解需求与约束", parallel: false },
      { title: "收集资料（路线 A）", parallel: false },
      { title: "收集资料（路线 B）", parallel: false },
      { title: "汇总对比并输出", parallel: false },
    ].map((b, i) => ({
      id: `plan-${i + 1}`,
      title: b.title,
      status: i === 0 ? ("running" as const) : ("pending" as const),
      kind: "plan" as const,
      parallelGroupId: undefined,
    }));
  }
  const base = [
    { title: "理解需求与约束", parallel: false },
    { title: "收集/读取必要资料", parallel: false },
    { title: "执行主要处理", parallel: false },
    { title: "整理输出并自检", parallel: false },
  ];
  return base.map((b, i) => ({
    id: `plan-${i + 1}`,
    title: b.title,
    status: i === 0 ? "running" : "pending",
    kind: "plan" as const,
    parallelGroupId: undefined,
  }));
}

export function parseTaskPlanFromAssistant(text: string): TaskPlanStep[] | null {
  const m = text.match(PLAN_BLOCK_RE);
  if (!m?.[1]) return null;
  const lines = m[1].split("\n");
  const steps: TaskPlanStep[] = [];
  for (const line of lines) {
    const hit = line.match(PLAN_LINE_RE);
    if (!hit?.[1]) continue;
    let title = hit[1].trim();
    const parallel = /\(并行\)|\[并行\]/i.test(title);
    title = title.replace(/\(并行\)|\[并行\]/gi, "").trim();
    if (!title) continue;
    steps.push({
      id: `plan-${steps.length + 1}`,
      title,
      status: steps.length === 0 ? "running" : "pending",
      kind: "plan",
      parallelGroupId: parallel ? "pg-parallel" : undefined,
    });
    if (steps.length >= 8) break;
  }
  return steps.length >= 2 ? steps : null;
}

export function planStepsToPipelineSteps(
  plan: TaskPlanStep[],
  sendId: string,
): PipelineStep[] {
  return plan.map((p) => ({
    id: p.id,
    title: p.title,
    status: p.status,
    kind: "plan" as const,
    parallelGroupId: p.parallelGroupId,
    sendId,
    startedAt: p.status !== "pending" ? new Date().toISOString() : undefined,
  }));
}

export function advancePlanOnToolProgress(steps: PipelineStep[]): PipelineStep[] {
  const planIdx = steps.findIndex((s) => s.kind === "plan" && s.status === "running");
  if (planIdx < 0) return steps;
  const toolSteps = steps.filter((s) => s.kind !== "plan");
  // 尚无工具事件时不推进计划，避免 ingest 空轮询误标完成
  if (toolSteps.length === 0) return steps;
  const runningTools = toolSteps.filter((s) => s.status === "running").length;
  if (runningTools > 0) return steps;
  const next = [...steps];
  const now = new Date().toISOString();
  next[planIdx] = { ...next[planIdx]!, status: "success", endedAt: now };
  const pending = next.findIndex((s) => s.kind === "plan" && s.status === "pending");
  if (pending >= 0) {
    next[pending] = { ...next[pending]!, status: "running", startedAt: now };
  }
  return next;
}

export function mergeParsedPlanIntoSteps(
  steps: PipelineStep[],
  parsed: TaskPlanStep[],
  sendId: string,
): PipelineStep[] {
  const toolSteps = steps.filter((s) => s.kind !== "plan");
  return [...planStepsToPipelineSteps(parsed, sendId), ...toolSteps];
}

const HANDOFF_SUMMARY_MAX_CHARS = 2_800;
const HANDOFF_MESSAGE_CLIP = 220;
const HANDOFF_MAX_MESSAGES = 8;

export function buildSessionHandoffSummary(messages: LocalMessageRow[]): string {
  const recent = messages.slice(-HANDOFF_MAX_MESSAGES);
  const lines: string[] = [
    "【上一对话摘要 · 由云图自动整理，供新对话接续】",
    "",
  ];
  for (const m of recent) {
    const role = m.role === "user" ? "用户" : m.role === "assistant" ? "助手" : "系统";
    let body = m.content.replace(/\s+/g, " ").trim();
    if (!body || body.startsWith("[错误]")) continue;
    if (body.includes("【云图会话接续】")) {
      const sep = body.lastIndexOf("---");
      if (sep >= 0) body = body.slice(sep + 3).trim();
    }
    if (!body) continue;
    const clipped = body.length > HANDOFF_MESSAGE_CLIP ? `${body.slice(0, HANDOFF_MESSAGE_CLIP - 1)}…` : body;
    lines.push(`- ${role}：${clipped}`);
    if (lines.join("\n").length >= HANDOFF_SUMMARY_MAX_CHARS) break;
  }
  lines.push("", "请基于以上上下文继续协助用户，无需重复已完成的步骤。");
  const joined = lines.join("\n");
  return joined.length > HANDOFF_SUMMARY_MAX_CHARS
    ? `${joined.slice(0, HANDOFF_SUMMARY_MAX_CHARS - 1)}…`
    : joined;
}

export function buildAcceptanceChecklist(
  summary: TaskDeliverySummary,
  steps: PipelineStep[],
  opts?: { assistantText?: string },
): AcceptanceCheckItem[] {
  const tools = steps.filter((s) => s.kind !== "plan");
  const planSteps = steps.filter((s) => s.kind === "plan");
  const failed = tools.filter((s) => s.status === "failed").length;
  const running = tools.filter((s) => s.status === "running").length;
  const assistantText = opts?.assistantText?.trim() ?? "";
  const needsArtifacts =
    planSteps.some((s) => /产出|文件|导出|保存|output/i.test(s.title)) ||
    /产出|文件|导出|保存到|output/i.test(assistantText);

  const items: AcceptanceCheckItem[] = [
    {
      id: "steps",
      label: "执行步骤无致命失败",
      passed: failed === 0 && running === 0,
      detail:
        tools.length > 0
          ? `工具步骤 ${summary.stepSuccess}/${summary.stepTotal} 成功`
          : "本轮无工具步骤",
    },
    {
      id: "reply",
      label: "收到可读的助手回复",
      passed: Boolean(assistantText) && assistantText.length >= 8,
      detail: assistantText ? `约 ${assistantText.length} 字` : "暂无正文",
    },
    {
      id: "artifacts",
      label: "产出文件（若任务需要）",
      passed:
        !needsArtifacts ||
        summary.artifactCount > 0 ||
        summary.outcome === "cancelled",
      detail:
        summary.artifactCount > 0
          ? `${summary.artifactCount} 个文件`
          : needsArtifacts
            ? "任务需要产出但未检测到新文件"
            : "未检测到新文件（纯对话任务可忽略）",
    },
    {
      id: "plan",
      label: "任务计划已推进",
      passed:
        planSteps.length === 0 ||
        planSteps.every((s) => s.status === "success" || s.status === "skipped"),
      detail:
        planSteps.length > 0
          ? `${planSteps.filter((s) => s.status === "success").length}/${planSteps.length} 步完成`
          : "无显式计划",
    },
  ];
  return items;
}

export function acceptanceHeadline(items: AcceptanceCheckItem[]): string {
  const failed = items.filter((i) => !i.passed).length;
  if (failed === 0) return "验收通过";
  if (failed === 1) return "基本完成，1 项待确认";
  return `${failed} 项待确认`;
}

export type ParallelSubtaskResult = {
  id: string;
  title: string;
  ok: boolean;
  excerpt: string;
};

/** 后台并行子任务：不占用主会话 isSending，使用独立 remote session。 */
export async function runParallelSubtasks(
  items: { id: string; title: string; prompt: string }[],
  opts?: {
    parentLabel?: string;
    onItemStart?: (item: { id: string; title: string }) => void;
    onItemDone?: (result: ParallelSubtaskResult) => void;
  },
): Promise<ParallelSubtaskResult[]> {
  if (!items.length) return [];
  const client = getGatewayClient();
  const labelBase = opts?.parentLabel?.trim() || "并行子任务";

  const runOne = async (item: { id: string; title: string; prompt: string }) => {
    opts?.onItemStart?.({ id: item.id, title: item.title });
    let remoteKey: string | undefined;
    try {
      const localId = crypto.randomUUID();
      remoteKey = await gatewayCreateRemoteSession(`${labelBase} · ${item.title}`, localId);
      if (!remoteKey) {
        return { id: item.id, title: item.title, ok: false, excerpt: "无法创建子会话" };
      }
      const baseline = await fetchAssistantBaseline((m, p) => client.request(m, p), remoteKey);
      const params = buildSessionsSendParams(remoteKey, item.prompt, {
        timeoutMs: 3_600_000,
        idempotencyKey: crypto.randomUUID(),
      });
      await client.request("sessions.send", params);
      const reply = await pollForNewAssistantAfterSend(
        (m, p) => client.request(m, p),
        remoteKey,
        baseline,
        { timeoutMs: 3_500_000 },
      );
      const text = typeof reply === "string" ? reply.trim() : "";
      const result = {
        id: item.id,
        title: item.title,
        ok: Boolean(text),
        excerpt: text ? text.slice(0, 500) : "（无回复）",
      };
      opts?.onItemDone?.(result);
      return result;
    } catch (e) {
      const result = {
        id: item.id,
        title: item.title,
        ok: false,
        excerpt: e instanceof Error ? e.message : String(e),
      };
      opts?.onItemDone?.(result);
      return result;
    } finally {
      // 子任务会话一次性使用，完成后删除，避免远程会话堆积占用 token/索引
      if (remoteKey) {
        gatewaySessionDelete(remoteKey).catch(() => undefined);
      }
    }
  };

  return Promise.all(items.map(runOne));
}

export function extractParallelSubtaskPrompts(plan: TaskPlanStep[], userGoal: string): {
  id: string;
  title: string;
  prompt: string;
}[] {
  const parallel = plan.filter((p) => p.parallelGroupId);
  if (parallel.length < 2) return [];
  return parallel.map((p) => ({
    id: p.id,
    title: p.title,
    prompt: `【并行子任务】${p.title}\n\n总目标：${userGoal.trim().slice(0, 500)}\n\n请只完成本子任务并给出简要结果。`,
  }));
}

export function formatParallelResultsBlock(results: ParallelSubtaskResult[]): string {
  if (!results.length) return "";
  const lines = ["", "---", "【并行子任务汇总】", ""];
  for (const r of results) {
    lines.push(`### ${r.title}（${r.ok ? "完成" : "失败"}）`);
    lines.push(r.excerpt);
    lines.push("");
  }
  return lines.join("\n");
}

export function countRunningTools(steps: PipelineStep[]): number {
  return steps.filter((s) => s.kind !== "plan" && s.status === "running").length;
}

export function scheduleParallelSubtasksFollowUp(
  sessionId: string,
  sendId: string,
  userGoal: string,
  assistantText: string,
  deps: {
    appendBlock: (text: string) => Promise<void>;
    isConnected: () => boolean;
    showToast: (message: string, kind: "info" | "success" | "error") => void;
    openSidePanel?: () => void;
  },
): void {
  // 仅当助手显式写出「(并行)」步骤时才后台开子会话，避免启发式计划误开多 Agent
  const parsedPlan = parseTaskPlanFromAssistant(assistantText);
  if (!parsedPlan) return;
  const parallelItems = extractParallelSubtaskPrompts(parsedPlan, userGoal);
  if (parallelItems.length < 2 || !deps.isConnected()) return;
  if (!isParallelSubtaskEnabled()) return;

  void (async () => {
    const { useParallelSubtaskStore } = await import("../../stores/parallelSubtaskStore");
    const runId = useParallelSubtaskStore.getState().beginRun({
      id: `pr-${sendId}`,
      sessionId,
      parentSendId: sendId,
      parentLabel: userGoal.slice(0, 32),
      items: parallelItems.map((p) => ({ id: p.id, title: p.title })),
    });
    deps.openSidePanel?.();
    deps.showToast(`正在后台并行执行 ${parallelItems.length} 个子任务…`, "info");
    try {
      const parallelResults = await runParallelSubtasks(parallelItems, {
        parentLabel: userGoal.slice(0, 24),
        onItemStart: (item) => {
          useParallelSubtaskStore.getState().patchItem(runId, item.id, {
            status: "running",
            startedAt: new Date().toISOString(),
          });
        },
        onItemDone: (result) => {
          useParallelSubtaskStore.getState().patchItem(runId, result.id, {
            status: result.ok ? "success" : "failed",
            excerpt: result.excerpt,
            endedAt: new Date().toISOString(),
          });
        },
      });
      useParallelSubtaskStore.getState().finishRun(runId);
      const block = formatParallelResultsBlock(parallelResults);
      if (block.trim()) await deps.appendBlock(block);
      const failed = parallelResults.filter((r) => !r.ok).length;
      if (failed > 0) {
        deps.showToast(`并行子任务完成，${failed} 项失败`, "error");
      } else {
        deps.showToast("并行子任务全部完成", "success");
      }
    } catch {
      useParallelSubtaskStore.getState().finishRun(runId);
      deps.showToast("并行子任务执行失败", "error");
    }
  })();
}

export function formatToolStepTitle(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const p = payload as Record<string, unknown>;
  const d = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : null;
  const name = [p.name, p.tool, p.command, d?.name, d?.tool, d?.command].find(
    (x) => typeof x === "string" && x.trim(),
  ) as string | undefined;
  const argsRaw = p.args ?? p.input ?? d?.args ?? d?.input;
  let argsHint = "";
  if (typeof argsRaw === "string" && argsRaw.trim()) {
    argsHint = argsRaw.trim().slice(0, 48);
  } else if (argsRaw && typeof argsRaw === "object") {
    try {
      argsHint = JSON.stringify(argsRaw).slice(0, 48);
    } catch {
      argsHint = "";
    }
  }
  if (name && argsHint) return `工具: ${name} · ${argsHint}`;
  if (name) return `工具: ${name}`;
  return fallback;
}
