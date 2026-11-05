/**
 * 云图 Agent 内核增强层（对标 WorkBuddy 式：意图识别 → 规划提示 → 本地安全 → 可交付验收）。
 * 不替代 OpenClaw 执行循环，仅在发送前注入结构化约定。
 */
import {
  shouldEnableTaskOrchestration,
  withTaskPlanningHint,
  type TaskPlanStep,
  buildHeuristicTaskPlan,
} from "./task-orchestration";
import type { OfficeAttachmentKind } from "../chat/office-workbench";
import {
  AUTOMATION_EXECUTION_CONTRACT,
  OFFICE_EXECUTION_CONTRACT,
  officeKindsLabel,
} from "../chat/office-workbench";
import { buildOfficeCapabilityContract } from "./openclaw-office-capability-contract";
import { OFFICE_BREVITY_HINT, OFFICE_DELIVERABLE_HINT } from "./reply-style";

export type AgentKernelOpts = {
  templateId?: string;
  hasAttachments?: boolean;
  /** 办公类附件（表格/文档/PPT/CSV/PDF/图片） */
  officeAttachmentKinds?: OfficeAttachmentKind[];
  /** 用户开启「仅本机执行」：禁止联网/外发工具 */
  localOnlyMode?: boolean;
};

export type TaskIntent =
  | "document"
  | "data"
  | "research"
  | "communication"
  | "automation"
  | "sensitive"
  | "general";

const OFFICE_TASK_RE =
  /帮我|整理|分析|生成|调研|对比|汇总|方案|报告|表格|文档|处理|编写|制作|导出|转换|清洗|合并|拆分|归档|发票|报销|合同|简历|邮件|周报|月报|ppt|excel|word|幻灯片|纪要|审查|核对|批量|自动化|定时|提醒/i;

const SENSITIVE_LOCAL_RE =
  /财务|合同|密码|密钥|内网|报销|工资|薪资|身份证|银行卡|机密|保密|审计|凭证|账套|erp|人事档案/i;

const LOCAL_FIRST_HINT = `

---
【云图·本地优先】任务涉及敏感或内部数据：仅在用户授权的本机目录内读写，勿将原文上传外部 API；对外发送（邮件/消息）前须说明收件人与内容摘要。`;

const LOCAL_ONLY_ENFORCED_HINT = `

---
【云图·仅本机执行·用户已开启】禁止调用联网搜索、HTTP 请求、外发邮件/消息、云端沙箱类工具；仅使用本机授权目录内的文件读写、本地 Shell/Office 处理。若任务必须外联，请先说明原因并等待用户关闭「仅本机」模式。`;

const DELIVERABLE_HINT = OFFICE_DELIVERABLE_HINT;

/** 轻量意图分类（无独立 NLU 模型，靠关键词路由提示策略）。 */
export function classifyTaskIntent(text: string): TaskIntent {
  const t = text.trim();
  if (!t) return "general";
  if (SENSITIVE_LOCAL_RE.test(t)) return "sensitive";
  if (/调研|对比|竞品|行业|资料|检索|搜索|收集/.test(t)) return "research";
  if (/excel|表格|数据|统计|透视|图表|清洗|csv|json|xlsx|sheet/.test(t)) return "data";
  if (/word|doc|ppt|幻灯片|报告|文档|纪要|合同|简历|周报|月报|日报|wps/.test(t)) return "document";
  if (/邮件|消息|通知|钉钉|企微|飞书|slack|telegram/.test(t)) return "communication";
  if (/定时|自动化|批处理|监控|脚本|每天|每周|cron/.test(t)) return "automation";
  return "general";
}

export function isSensitiveLocalTask(text: string): boolean {
  return SENSITIVE_LOCAL_RE.test(text.trim());
}

/** 扩展任务编排触发：覆盖更多日常办公表述。 */
export function shouldUseAgentKernel(text: string, opts?: AgentKernelOpts): boolean {
  if (shouldEnableTaskOrchestration(text, opts)) return true;
  const t = text.trim();
  if (t.length >= 60 && OFFICE_TASK_RE.test(t)) return true;
  if (opts?.hasAttachments && t.length >= 12) return true;
  if (opts?.officeAttachmentKinds?.length) return true;
  return false;
}

export type AgentKernelEnrichment = {
  payload: string;
  orchestrationEnabled: boolean;
  intent: TaskIntent;
  initialPlan: TaskPlanStep[] | null;
};

/** 发送前统一注入内核提示（规划 + 安全 + 验收）。 */
export function enrichPayloadWithAgentKernel(
  rawPayload: string,
  opts?: AgentKernelOpts,
): AgentKernelEnrichment {
  const payload = rawPayload.trim();
  const intent = classifyTaskIntent(payload);
  const orchestrationEnabled = shouldUseAgentKernel(payload, opts);

  if (!orchestrationEnabled) {
    let payloadOut = rawPayload;
    if (opts?.localOnlyMode) {
      payloadOut = `${rawPayload.trim()}${LOCAL_ONLY_ENFORCED_HINT}`;
    }
    return { payload: payloadOut, orchestrationEnabled: false, intent, initialPlan: null };
  }

  let enriched = withTaskPlanningHint(payload);
  if (opts?.localOnlyMode) {
    enriched += LOCAL_ONLY_ENFORCED_HINT;
  } else if (intent === "sensitive" || isSensitiveLocalTask(payload)) {
    enriched += LOCAL_FIRST_HINT;
  }
  const officeKinds = opts?.officeAttachmentKinds ?? [];
  if (officeKinds.length > 0) {
    enriched += OFFICE_EXECUTION_CONTRACT;
    enriched += `\n（本次附件类型：${officeKindsLabel(officeKinds)}）`;
    const contract = buildOfficeCapabilityContract(officeKinds);
    if (contract) {
      enriched += `\n（办公 skill 契约：${contract.skillIds.join(", ")}；版本 ${contract.version}）`;
    }
  }
  if (intent === "automation") {
    enriched += AUTOMATION_EXECUTION_CONTRACT;
  }
  enriched += OFFICE_BREVITY_HINT;
  if (intent !== "general") {
    enriched += DELIVERABLE_HINT;
  }

  const initialPlan = buildHeuristicTaskPlan(payload, { intent, officeKinds });
  return { payload: enriched, orchestrationEnabled: true, intent, initialPlan };
}
