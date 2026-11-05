import type { ModelSelectionId } from "../../types/model";
import { KB_ASSISTANT_AGENT_ID } from "./kb-assistant-bridge";

export function isKbAssistantAgentId(agentId: string | null | undefined): boolean {
  return agentId?.trim() === KB_ASSISTANT_AGENT_ID;
}

/** 发送时以会话绑定 Agent 为准，否则用顶部当前 Agent。 */
export function resolveEffectiveAgentIdForSend(
  sessionAgentId: string | null | undefined,
  activeAgentId: string | null | undefined,
): string | null {
  const session = sessionAgentId?.trim();
  if (session) return session;
  return activeAgentId?.trim() || null;
}

/** 知识库助手与普通对话一样，发送时使用用户当前选择的模型。 */
export function resolveModelSelectionForSend(opts: {
  sessionAgentId: string | null | undefined;
  activeAgentId: string | null | undefined;
  uiSelectionId: ModelSelectionId;
}): ModelSelectionId {
  void opts.sessionAgentId;
  void opts.activeAgentId;
  return opts.uiSelectionId;
}

export function sessionAgentMatchesActive(
  sessionAgentId: string | null | undefined,
  activeAgentId: string | null | undefined,
): boolean {
  if (!activeAgentId?.trim()) return true;
  const session = sessionAgentId?.trim();
  if (!session) return false;
  return session === activeAgentId.trim();
}
