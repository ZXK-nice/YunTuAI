/**
 * OpenClaw Gateway 事件字段归一化（对齐 session.tool / session.item / chat 等常见帧）。
 */
import type { StepStatus } from "../../types/pipeline-step";
import { isChatPipelineCloseState } from "./chat-payload-terminal";
import { isGatewayNoopEvent } from "./gateway-noop-events";
import { formatToolStepTitle } from "./task-orchestration";
import { summarizeOfficeAttachments } from "../chat/office-workbench";
import {
  buildOfficeCapabilityContract,
  officeCapabilityToMetadata,
} from "./openclaw-office-capability-contract";
import type { YunTuAiSendMetadata } from "./session-rpc";

export type NormalizedGatewayEvent = {
  eventName: string;
  sessionKey?: string;
  messageId?: string;
  toolCallId?: string;
  runId?: string;
  title: string;
  status: StepStatus;
  detail?: string;
  streamKind?: string;
};

function pickStatusPhaseState(payload: Record<string, unknown> | null): unknown {
  if (!payload) return undefined;
  const top = payload.status ?? payload.phase ?? payload.state;
  if (top != null && String(top).trim() !== "") return top;
  const d = payload.data;
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  return o.status ?? o.phase ?? o.state;
}

export function inferStepStatusFromPayload(payload: unknown, event: string): StepStatus {
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return "success";
  const el = String(event).toLowerCase();
  const raw = pickStatusPhaseState(p);
  const sv = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    sv === "done" ||
    sv === "ok" ||
    sv === "success" ||
    sv === "final" ||
    sv === "complete" ||
    sv === "completed" ||
    sv === "ended" ||
    sv === "end"
  ) {
    return "success";
  }
  if (sv === "error" || sv === "failed") return "failed";
  if (sv === "skipped") return "skipped";
  if (sv === "pending" || sv === "queued") return "pending";
  if (sv === "running" || sv === "inflight" || sv === "active" || sv === "start") return "running";
  if (sv === "partial" || sv === "delta" || sv === "streaming" || sv === "in_progress") return "running";
  const nestedRaw = p.data;
  const nested =
    nestedRaw && typeof nestedRaw === "object" ? (nestedRaw as Record<string, unknown>) : null;
  if (p.ok === false || nested?.ok === false) return "failed";
  if (p.ok === true || p.done === true || nested?.ok === true || nested?.done === true) return "success";
  if (p.error != null && String(p.error).trim() !== "") return "failed";
  if (el.includes("tool") && (p.result != null || nested?.result != null)) return "success";
  if (!el.includes("tool") && (p.message != null || p.role != null)) return "success";
  return "running";
}

export function extractGatewayEventIds(payload: unknown): {
  sessionKey?: string;
  messageId?: string;
  toolCallId?: string;
  runId?: string;
} {
  if (!payload || typeof payload !== "object") return {};
  const p = payload as Record<string, unknown>;
  const nested =
    p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : null;
  const sessionKeyRaw = p.sessionKey ?? p.key ?? nested?.sessionKey ?? nested?.key;
  const messageIdRaw = p.messageId ?? nested?.messageId;
  const toolCallIdRaw = p.toolCallId ?? nested?.toolCallId ?? p.id ?? nested?.id;
  const runIdRaw = p.runId ?? nested?.runId;
  return {
    sessionKey:
      typeof sessionKeyRaw === "string" && sessionKeyRaw.trim() ? sessionKeyRaw.trim() : undefined,
    messageId:
      typeof messageIdRaw === "string" && messageIdRaw.trim() ? messageIdRaw.trim() : undefined,
    toolCallId:
      typeof toolCallIdRaw === "string" && toolCallIdRaw.trim() ? toolCallIdRaw.trim() : undefined,
    runId: typeof runIdRaw === "string" && runIdRaw.trim() ? runIdRaw.trim() : undefined,
  };
}

export function normalizeGatewayEvent(event: string, payload: unknown): NormalizedGatewayEvent | null {
  if (isGatewayNoopEvent(event)) {
    return null;
  }

  const el = String(event).toLowerCase();
  const pObj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const ids = extractGatewayEventIds(payload);
  const streamKind =
    pObj && typeof pObj.stream === "string" ? pObj.stream.trim().toLowerCase() : undefined;
  const chatState = pObj ? pickStatusPhaseState(pObj) : undefined;
  const isChatTurnClosed =
    (el === "chat" || el.endsWith(".chat")) && isChatPipelineCloseState(chatState);
  const status = isChatTurnClosed ? "success" : inferStepStatusFromPayload(payload, event);

  const title =
    el === "session.tool" || el.includes("tool")
      ? formatToolStepTitle(payload, summarizeToolPayload(payload))
      : event.length > 48
        ? `${event.slice(0, 45)}…`
        : event;

  let detail: string | undefined;
  try {
    const s = JSON.stringify(payload);
    detail = s.length > 600 ? `${s.slice(0, 597)}…` : s;
  } catch {
    detail = undefined;
  }

  return {
    eventName: event,
    sessionKey: ids.sessionKey,
    messageId: ids.messageId,
    toolCallId: ids.toolCallId,
    runId: ids.runId,
    title,
    status,
    detail,
    streamKind,
  };
}

function summarizeToolPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "工具调用";
  const p = payload as Record<string, unknown>;
  const d = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>) : null;
  const name = p.name ?? p.tool ?? p.command ?? d?.name ?? d?.tool ?? d?.command;
  if (typeof name === "string" && name.trim()) return `工具: ${name}`;
  return "工具调用";
}

const PRE_EXTRACT_MARKERS = [
  "【OCR",
  "【表格预提取】",
  "【PDF 预提取】",
  "【提取正文】",
  "【OCR 预识别】",
  "【文档预提取】",
];

function simpleContentHash(text: string): string {
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return (h >>> 0).toString(16);
}

/** 从已注入上下文的 remotePayload 提取预提取/OCR 摘要与哈希。 */
export function extractPreExtractMeta(remotePayload: string): {
  summary?: string;
  hash?: string;
} {
  const text = remotePayload.trim();
  if (!text) return {};
  const lines = text.split("\n");
  const blocks: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const hit = PRE_EXTRACT_MARKERS.some((m) => line.includes(m));
    if (hit) {
      inBlock = true;
      blocks.push(line);
      continue;
    }
    if (inBlock) {
      if (line.startsWith("---") || line.startsWith("【云图")) break;
      blocks.push(line);
    }
  }
  const summary = blocks.join("\n").trim();
  if (!summary) return {};
  return {
    summary: summary.slice(0, 2_000),
    hash: simpleContentHash(summary),
  };
}

/** 构造 sessions.send metadata.yuntuai* 字段。 */
export function buildYuntuaiSendMetadata(opts: {
  sendId: string;
  taskOrchestration?: boolean;
  attachedFiles?: { name: string }[];
  remotePayload?: string;
}): YunTuAiSendMetadata {
  const meta: YunTuAiSendMetadata = { sendId: opts.sendId };
  if (opts.taskOrchestration) meta.taskPlanId = opts.sendId;
  if (opts.attachedFiles?.length) {
    const kinds = summarizeOfficeAttachments(opts.attachedFiles);
    if (kinds.length) {
      meta.officeAttachmentKinds = kinds;
      const contract = buildOfficeCapabilityContract(kinds);
      if (contract) {
        meta.officeContractVersion = contract.version;
        meta.officeSkillIds = contract.skillIds;
        meta.officeCapabilityMetadata = officeCapabilityToMetadata(contract);
      }
    }
  }
  const pre = extractPreExtractMeta(opts.remotePayload ?? "");
  if (pre.hash) meta.ocrContentHash = pre.hash;
  if (pre.summary) meta.preExtractSummary = pre.summary;
  return meta;
}
