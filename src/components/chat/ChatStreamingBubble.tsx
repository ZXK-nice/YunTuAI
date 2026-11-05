import { memo, useLayoutEffect, useMemo } from "react";
import {
  collapseStreamRepetition,
  tryParseDisplayPayloadJson,
} from "../../lib/chat/assistant-message-display";
import {
  isDeliveredAssistantContent,
  partitionAssistantContent,
} from "../../lib/chat/deliverable-content";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { AgentAvatar } from "../ui/AgentAvatar";
import { ThinkingBlock } from "./ThinkingBlock";
import { MessageBody } from "./chat-markdown";

type AgentInfo = { id: string; name: string } | null;

/** 草稿已清且本轮最后一条已是可交付正文时，不再叠「整理回答中」。 */
export function shouldHideStreamingPlaceholder(
  bodyText: string,
  thinkingText: string,
  messages: Array<{ role: string; content: string }>,
): boolean {
  if (bodyText.trim() || thinkingText.trim()) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const role = m.role.trim().toLowerCase();
    if (role === "user" || role === "human") return false;
    if ((role === "assistant" || role === "model") && isDeliveredAssistantContent(m.content)) {
      return true;
    }
  }
  return false;
}

type Props = {
  sessionId: string;
  activeAgent: AgentInfo;
  /** 发送预处理 / 网关阶段说明（尚无流式正文时展示） */
  progressLabel?: string | null;
  onContentChange?: () => void;
};

/** 独立订阅流式草稿，避免每条 delta 重渲染历史消息列表。
 *  区分「思考过程」与「正文回复」两类流式输出：
 *  - reasoning_content / thinking → ThinkingBlock（可折叠）
 *  - 普通正文 → MessageBody（直接渲染，带流式光标） */
export const ChatStreamingBubble = memo(function ChatStreamingBubble({
  sessionId,
  activeAgent,
  progressLabel,
  onContentChange,
}: Props) {
  const streamingDraft = useSessionStore((s) => s.streamingDraftBySession[sessionId]);
  const thinkingDraft = useSessionStore((s) => s.thinkingDraftBySession[sessionId]);
  const busy = useSessionStore((s) => s.isSending);
  const queuedSendPending = useSessionStore((s) => s.queuedSendPending);
  const sendingSessionId = useSessionStore((s) => s.sendingSessionId);
  const connState = useGatewayStore((s) => s.connState);
  const hasPersistedDeliverable = useSessionStore((s) =>
    shouldHideStreamingPlaceholder("", "", s.messagesBySession[sessionId] ?? []),
  );

  const { bodyText, thinkingText } = useMemo(() => {
    const rawBody = streamingDraft?.trim() ?? "";
    const rawThink = thinkingDraft?.trim() ?? "";
    const leaked = rawBody ? tryParseDisplayPayloadJson(rawBody) : null;
    const mergedBody = collapseStreamRepetition(leaked?.text?.trim() || rawBody);
    const mergedThink = collapseStreamRepetition(leaked?.thinking?.trim() || rawThink);
    const partitioned = partitionAssistantContent(mergedBody, mergedThink);
    const body = partitioned.body.trim();
    const think = (partitioned.thinking ?? "").trim();
    if (think && think === body) {
      return { bodyText: body, thinkingText: "" };
    }
    return { bodyText: body, thinkingText: think };
  }, [streamingDraft, thinkingDraft]);

  useLayoutEffect(() => {
    if (bodyText || thinkingText) onContentChange?.();
  }, [bodyText, thinkingText, onContentChange]);

  const showQueued = queuedSendPending && sendingSessionId === sessionId;
  if (!showQueued && (!busy || connState !== "connected" || sendingSessionId !== sessionId)) {
    return null;
  }

  const hasReasoning = Boolean(thinkingText);
  const hasStreamText = Boolean(bodyText);
  if (
    !hasStreamText &&
    !hasReasoning &&
    hasPersistedDeliverable
  ) {
    return null;
  }

  // 思考阶段：只有 reasoning 内容，正文还没出来
  const inThinkingPhase = hasReasoning && !hasStreamText;

  return (
    <div className="message-enter-assistant chat-streaming-bubble flex w-full justify-start gap-3">
      {activeAgent ? (
        <AgentAvatar agentId={activeAgent.id} agentName={activeAgent.name} size={32} />
      ) : (
        <div
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--text-primary)] text-xs font-semibold text-[var(--bg-elevated)]"
          aria-hidden
        >
          AI
        </div>
      )}
      <div className="assistant-bubble w-full min-w-0 max-w-[min(100%,65%,48rem)] rounded-[var(--radius-xl)] px-5 py-4">
        {/* 真正的推理/思考过程（仅当有 reasoning_content 时才显示） */}
        {hasReasoning && (
          <ThinkingBlock
            text={thinkingText}
            streaming
            defaultCollapsed
          />
        )}

        {/* 正文流式输出：区分思考阶段和回答阶段 */}
        {hasStreamText ? (
          <MessageBody text={bodyText} variant="assistant" streaming />
        ) : inThinkingPhase ? (
          // 正在思考中，正文还没出来
          <div className="flex min-w-0 items-center gap-3">
            <div className="yt-typing-dots" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">思考中…</span>
          </div>
        ) : (
          // 刚开始还没有任何内容
          <div className="flex min-w-0 items-center gap-3">
            <div className="yt-typing-dots" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">
              {progressLabel?.trim() || "整理回答中…"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
