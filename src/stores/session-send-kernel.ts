import type { OfficeAttachmentKind } from "../lib/chat/office-workbench";
import { summarizeOfficeAttachments } from "../lib/chat/office-workbench";
import { enrichPayloadWithAgentKernel } from "../lib/openclaw/agent-kernel";
import {
  buildHeuristicTaskPlan,
  planStepsToPipelineSteps,
} from "../lib/openclaw/task-orchestration";
import type { PipelineStep } from "../types/pipeline-step";

export type SendKernelPrepOpts = {
  templateId?: string;
  attachedFiles?: { name: string }[];
  localOnlyMode?: boolean;
  localDisplay: string;
  sendId: string;
};

export type SendKernelPrepResult = {
  remotePayload: string;
  taskOrchestration: boolean;
  initialPlanSteps: PipelineStep[] | undefined;
};

/** 发送前 Agent 内核增强与任务计划初始化（从 sessionStore 拆出）。 */
export function prepareSendKernel(
  remotePayload: string,
  opts: SendKernelPrepOpts,
): SendKernelPrepResult {
  const hasAttachments = Boolean(opts.attachedFiles?.length);
  const officeAttachmentKinds: OfficeAttachmentKind[] = opts.attachedFiles?.length
    ? summarizeOfficeAttachments(opts.attachedFiles)
    : [];
  const kernel = enrichPayloadWithAgentKernel(remotePayload, {
    templateId: opts.templateId,
    hasAttachments,
    officeAttachmentKinds,
    localOnlyMode: opts.localOnlyMode,
  });
  const taskOrchestration = kernel.orchestrationEnabled;
  const initialPlanSteps = taskOrchestration
    ? planStepsToPipelineSteps(
        kernel.initialPlan ?? buildHeuristicTaskPlan(opts.localDisplay, { intent: kernel.intent, officeKinds: officeAttachmentKinds }),
        opts.sendId,
      )
    : undefined;
  return {
    remotePayload: kernel.payload,
    taskOrchestration,
    initialPlanSteps,
  };
}
