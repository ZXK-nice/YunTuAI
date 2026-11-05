/**
 * Agent 多步工具调用时，网关 history 可能在同一用户轮次内写入多条 assistant 消息
 * （中间状态 + 最终汇总）。UI 与回填只应保留该轮最可交付的一条，避免刷新后气泡碎裂。
 */

import {
  isDeliveredAssistantContent,
  looksLikeEnglishReasoningWall,
} from "../chat/deliverable-content";

function isUserRole(role: string): boolean {
  const r = role.trim().toLowerCase();
  return r === "user" || r === "human";
}

function isAssistantRole(role: string): boolean {
  const r = role.trim().toLowerCase();
  return r === "assistant" || r === "model";
}

function assistantTextOf<T extends { content?: string; displayContent?: string }>(row: T): string {
  return (row.content ?? row.displayContent ?? "").trim();
}

/** 同轮多条 assistant 时优先保留可交付正文，避免英文推理墙盖住中文结论。 */
export function pickBestAssistantInTurn<T extends { role: string; content?: string; displayContent?: string }>(
  run: readonly T[],
): T | undefined {
  if (run.length === 0) return undefined;
  if (run.length === 1) return run[0];

  const delivered = run.filter((row) => isDeliveredAssistantContent(assistantTextOf(row)));
  if (delivered.length > 0) {
    return delivered[delivered.length - 1]!;
  }

  const nonWall = run.filter((row) => !looksLikeEnglishReasoningWall(assistantTextOf(row)));
  if (nonWall.length > 0) {
    return nonWall[nonWall.length - 1]!;
  }

  return run[run.length - 1]!;
}

/** 同一用户轮次内、应删除的冗余 assistant 消息 id（保留该轮最后一条）。 */
export function findSupersededAssistantMessageIds<T extends { id: string; role: string }>(
  rows: readonly T[],
): string[] {
  const toDelete: string[] = [];
  let assistantRun: T[] = [];

  const flushAssistants = () => {
    if (assistantRun.length <= 1) {
      assistantRun = [];
      return;
    }
    const keep = pickBestAssistantInTurn(assistantRun) ?? assistantRun[assistantRun.length - 1]!;
    for (const row of assistantRun) {
      if (row.id !== keep.id) toDelete.push(row.id);
    }
    assistantRun = [];
  };

  for (const row of rows) {
    if (isUserRole(row.role)) {
      flushAssistants();
    } else if (isAssistantRole(row.role)) {
      assistantRun.push(row);
    } else {
      flushAssistants();
    }
  }
  flushAssistants();
  return toDelete;
}

/** 同一用户轮次内连续 assistant 行只保留最后一条（内容最完整）。 */
export function collapseTurnAssistantMessages<T extends { role: string }>(rows: readonly T[]): T[] {
  if (rows.length <= 1) return [...rows];

  const out: T[] = [];
  let assistantRun: T[] = [];

  const flushAssistants = () => {
    if (assistantRun.length === 0) return;
    out.push(pickBestAssistantInTurn(assistantRun) ?? assistantRun[assistantRun.length - 1]!);
    assistantRun = [];
  };

  for (const row of rows) {
    if (isUserRole(row.role)) {
      flushAssistants();
      out.push(row);
    } else if (isAssistantRole(row.role)) {
      assistantRun.push(row);
    } else {
      flushAssistants();
      out.push(row);
    }
  }
  flushAssistants();
  return out;
}
