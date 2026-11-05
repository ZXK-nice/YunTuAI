/**
 * 轮次在 toolUse / replayInvalid 下提前结束、仅有规划无交付时，自动续跑。
 * 空回复或「尚未交付」的普通正文不自动续跑，避免把正常短回复续成循环。
 */

import { readAutoContinueIncomplete } from "../chat/auto-continue-prefs";
import { isInterruptedAssistantContent } from "../chat/context-cards";
import {
  isInterimAssistantStatus,
  isPlanningOnlyAssistantContent,
} from "../chat/deliverable-content";
import { shouldScheduleExternalJobFollowUp } from "./external-job-followup";

const MAX_AUTO_CONTINUE_PLANNING = 2;
const MAX_AUTO_CONTINUE_INTERRUPTED = 5;
const CONTINUE_DELAY_MS = 1_400;

const CONTINUE_PROMPT =
  "【自动续跑】请继续完成上一步：直接执行所需工具，给出中文结论与产出文件路径；不要只写规划或英文推理。";

const INTERRUPTED_CONTINUE_PROMPT = "继续";

const TOOL_CUTOFF_RE =
  /工具(?:调用|链)?(?:被)?(?:截断|中断)|stopReason["']?\s*[:=]\s*["']?toolUse|replayInvalid/i;

const continueAttemptsBySession = new Map<string, number>();

export type IncompleteTurnContinueDeps = {
  isSending: () => boolean;
  isConnected: () => boolean;
  showToast: (message: string, kind: "info" | "success" | "error" | "warning") => void;
  sendContinue: (prompt: string, attempt: number) => Promise<void>;
};

export function shouldScheduleIncompleteTurnContinue(assistantText: string): boolean {
  const text = assistantText.trim();
  if (!text) return false;
  if (shouldScheduleExternalJobFollowUp(text)) return false;
  if (isInterimAssistantStatus(text)) return false;
  if (isPlanningOnlyAssistantContent(text)) return true;
  if (isInterruptedAssistantContent(text)) return true;
  if (TOOL_CUTOFF_RE.test(text)) return true;
  if (/【未完成】/.test(text)) return true;
  return false;
}

export function resetIncompleteTurnContinue(sessionId: string): void {
  continueAttemptsBySession.delete(sessionId);
}

export function maxAutoContinueAttempts(assistantText: string): number {
  if (isInterruptedAssistantContent(assistantText)) return MAX_AUTO_CONTINUE_INTERRUPTED;
  return MAX_AUTO_CONTINUE_PLANNING;
}

export function continuePromptForAssistantText(assistantText: string): string {
  return isInterruptedAssistantContent(assistantText) ? INTERRUPTED_CONTINUE_PROMPT : CONTINUE_PROMPT;
}

export function scheduleIncompleteTurnContinue(
  sessionId: string,
  _sendId: string,
  assistantText: string,
  deps: IncompleteTurnContinueDeps,
): void {
  if (!readAutoContinueIncomplete()) {
    resetIncompleteTurnContinue(sessionId);
    return;
  }
  if (!shouldScheduleIncompleteTurnContinue(assistantText)) {
    resetIncompleteTurnContinue(sessionId);
    return;
  }

  const attempt = continueAttemptsBySession.get(sessionId) ?? 0;
  const maxAttempts = maxAutoContinueAttempts(assistantText);
  if (attempt >= maxAttempts) return;

  const nextAttempt = attempt + 1;
  continueAttemptsBySession.set(sessionId, nextAttempt);
  const continuePrompt = continuePromptForAssistantText(assistantText);

  void (async () => {
    await sleep(CONTINUE_DELAY_MS);
    if (deps.isSending()) return;
    if (!deps.isConnected()) {
      deps.showToast("服务未连接，无法自动续跑；请发送「继续」", "warning");
      return;
    }
    deps.showToast(`已自动续跑 ${nextAttempt}/${maxAttempts}`, "info");
    try {
      await deps.sendContinue(continuePrompt, nextAttempt);
    } catch {
      deps.showToast("自动续跑失败，请手动发送「继续」", "warning");
    }
  })();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 测试用：清空续跑计数 */
export function resetIncompleteTurnContinueForTests(): void {
  continueAttemptsBySession.clear();
}
