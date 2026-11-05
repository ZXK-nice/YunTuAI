/**
 * Shared gateway state helpers accessible by both stores without circular imports.
 * Extracted from gatewayStore to break the gatewayStore ↔ sessionStore cycle.
 */

/** 全局最近一次收到任何 WS 事件的时间戳，用于长任务空闲检测。 */
let lastAnyWsEventMs = 0;

export function getLastAnyWsEventMs(): number {
  return lastAnyWsEventMs;
}

export function setLastAnyWsEventMs(ms: number): void {
  lastAnyWsEventMs = ms;
}

/** 步骤摄取宽限期（ms），发送轮次结束后继续接收工具事件。 */
let stepIngestGraceUntil = 0;

export function extendStepIngestGrace(ms = 2500) {
  stepIngestGraceUntil = Math.max(stepIngestGraceUntil, Date.now() + ms);
}

export function getStepIngestGraceUntil(): number {
  return stepIngestGraceUntil;
}

export function setStepIngestGraceUntil(ms: number): void {
  stepIngestGraceUntil = ms;
}
