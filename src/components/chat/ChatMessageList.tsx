import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type { LocalMessageRow } from "../../stores/sessionStore";
import { ChatMessageRow } from "./ChatMessageRow";

type AgentInfo = { id: string; name: string } | null;

type Props = {
  messages: LocalMessageRow[];
  /** 滚动容器（ChatPanel 的 listRef） */
  scrollRef: RefObject<HTMLDivElement | null>;
  activeAgent: AgentInfo;
  onDelete: (messageId: string) => void;
};

const ESTIMATED_ROW_PX = 96;
/** 短会话直接渲染，避免虚拟列表测量与绝对定位造成大块空白。 */
const VIRTUALIZE_AT_COUNT = 16;

function PlainMessageList({
  messages,
  activeAgent,
  onDelete,
}: Omit<Props, "scrollRef">) {
  return (
    <div className="w-full space-y-6">
      {messages.map((m) => (
        <ChatMessageRow key={m.id} message={m} activeAgent={activeAgent} onDelete={onDelete} />
      ))}
    </div>
  );
}

function VirtualMessageList({
  messages,
  scrollRef,
  activeAgent,
  onDelete,
}: Props) {
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    overscan: 8,
    getItemKey: (index) => messages[index]?.id ?? index,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((virtualRow) => {
        const m = messages[virtualRow.index];
        if (!m) return null;
        return (
          <div
            key={m.id}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full pb-6"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <ChatMessageRow message={m} activeAgent={activeAgent} onDelete={onDelete} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * 虚拟化消息列表：长会话仅挂载可见行；短会话普通列表避免布局空洞。
 */
export function ChatMessageList(props: Props) {
  if (props.messages.length < VIRTUALIZE_AT_COUNT) {
    return (
      <PlainMessageList
        messages={props.messages}
        activeAgent={props.activeAgent}
        onDelete={props.onDelete}
      />
    );
  }
  return <VirtualMessageList {...props} />;
}
