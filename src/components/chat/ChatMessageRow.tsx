import { memo, useMemo } from "react";
import { parseAssistantMessageForBubble } from "../../lib/chat/assistant-message-display";
import { parseContextMessage } from "../../lib/chat/context-cards";
import { normalizeUserMessageForDedup } from "../../lib/openclaw/message-normalize";
import type { LocalMessageRow } from "../../stores/sessionStore";
import { useSessionStore } from "../../stores/sessionStore";
import { AgentAvatar } from "../ui/AgentAvatar";
import { ChatContextCardView } from "./ChatContextCardView";
import { MessageBody } from "./chat-markdown";
import { MessageFileChips } from "./MessageFileChips";
import { ThinkingBlock } from "./ThinkingBlock";

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}

function BubbleDeleteButton({
  variant,
  onRequest,
}: {
  variant: "user" | "assistant" | "system";
  onRequest: () => void;
}) {
  const btn =
    variant === "user"
      ? "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
      : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRequest();
      }}
      className={[
        "yt-press shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-45 [@media(hover:none)]:group-hover:opacity-100",
        btn,
      ].join(" ")}
      title="删除此条"
      aria-label="删除此条消息"
    >
      <IconTrash className="h-3.5 w-3.5" />
    </button>
  );
}

function bubbleRoleLabel(role: string) {
  if (role === "user") return "你";
  if (role === "assistant") return "AI";
  if (role === "system") return "系统";
  return role;
}

type AgentInfo = { id: string; name: string } | null;

type Props = {
  message: LocalMessageRow;
  activeAgent: AgentInfo;
  onDelete: (messageId: string) => void;
};

export const ChatMessageRow = memo(function ChatMessageRow({ message: m, activeAgent, onDelete }: Props) {
  const parsedContext = useMemo(
    () => parseContextMessage(m.displayContent, m.content),
    [m.displayContent, m.content],
  );
  const { text: bubbleText, files: bubbleFiles, thinking } = useMemo(() => {
    if (parsedContext.cards.length > 0) {
      return {
        text: parsedContext.text || m.content,
        files: parsedContext.files.length > 0 ? parsedContext.files : [],
        thinking: undefined as string | undefined,
      };
    }
    return parseAssistantMessageForBubble(m.displayContent, m.content);
  }, [m.displayContent, m.content, parsedContext]);

  const isUser = m.role === "user";
  const isSystem = m.role === "system";

  if (isSystem) {
    return (
      <div className="group relative message-enter-assistant chat-message-row flex w-full justify-center">
        <div className="relative max-w-[min(100%,40rem)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-4 py-2 text-xs leading-relaxed text-[var(--text-tertiary)]">
          <div className="absolute right-2 top-2">
            <BubbleDeleteButton variant="system" onRequest={() => onDelete(m.id)} />
          </div>
          <span className="mb-0.5 block text-center text-[10px] font-medium text-[var(--text-muted)]">
            {bubbleRoleLabel(m.role)}
          </span>
          <div className="whitespace-pre-wrap text-center">{m.content}</div>
        </div>
      </div>
    );
  }

  if (isUser) {
    const visibleText = normalizeUserMessageForDedup(bubbleText);
    if (!visibleText && parsedContext.cards.length === 0 && bubbleFiles.length === 0) {
      return null;
    }
    const isSending = m.sendStatus === "sending";
    const isFailed = m.sendStatus === "failed";
    return (
      <div className="group message-enter-user chat-message-row flex w-full justify-end">
        <div className={`user-bubble w-full max-w-[min(65%,48rem)] min-w-0 ${isSending ? "opacity-60" : ""}`}>
          <div className="user-bubble-text relative rounded-[var(--radius-xl)] px-5 py-3 pr-10">
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
              {isSending && (
                <svg className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" aria-label="发送中">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                </svg>
              )}
              <BubbleDeleteButton variant="user" onRequest={() => onDelete(m.id)} />
            </div>
            <div className="text-[15px] leading-relaxed text-[var(--user-bubble-body)]">
              {parsedContext.cards.length > 0 && (
                <div className="mb-2 flex flex-col gap-2">
                  {parsedContext.cards.map((card, i) => (
                    <ChatContextCardView key={`${card.kind}-${i}`} card={card} />
                  ))}
                </div>
              )}
              {bubbleFiles.length > 0 && <MessageFileChips files={bubbleFiles} variant="user" />}
              {bubbleText.trim() && (
                <MessageBody
                  text={visibleText || bubbleText}
                  variant="user"
                />
              )}
            </div>
          </div>
          {isFailed && (
            <span className="mt-1 block text-right text-[11px] text-[var(--text-muted)]">
              发送失败 ·{" "}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-error)]"
                onClick={(e) => {
                  e.stopPropagation();
                  void useSessionStore.getState().retryLastSend();
                }}
              >
                重试
              </button>
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group message-enter-assistant chat-message-row flex w-full max-w-full justify-start gap-3">
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
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="flex-1 text-xs font-medium text-[var(--text-tertiary)]">{bubbleRoleLabel(m.role)}</span>
          <BubbleDeleteButton variant="assistant" onRequest={() => onDelete(m.id)} />
        </div>
        <div className="text-[15px] leading-relaxed">
          {thinking?.trim() && <ThinkingBlock text={thinking} defaultCollapsed />}
          {/* 思考与回答之间的分割线 */}
          {thinking?.trim() && bubbleText.trim() && (
            <hr className="my-3 border-0 border-t border-[var(--border-subtle)]" />
          )}
          {bubbleFiles.length > 0 && <MessageFileChips files={bubbleFiles} variant="assistant" />}
          {bubbleText.trim() ? <MessageBody text={bubbleText} variant="assistant" /> : null}
        </div>
      </div>
    </div>
  );
});
