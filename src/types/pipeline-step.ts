export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type PipelineStep = {
  id: string;
  title: string;
  status: StepStatus;
  toolCallId?: string;
  agentId?: string;
  agentName?: string;
  /** 关联本次用户发送，用于过滤右侧面板步骤 */
  sendId?: string;
  startedAt?: string;
  endedAt?: string;
  detail?: string;
  /** plan = 任务计划步骤；tool = 网关工具事件（默认） */
  kind?: "plan" | "tool";
  parallelGroupId?: string;
  /** 网关 messageId，用于事件对齐与 SQLite 回放 */
  messageId?: string;
  /** 网关 agent runId（chat 事件帧） */
  runId?: string;
  /** 网关 sessionKey */
  sessionKey?: string;
};
