import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../../lib/tauri-env";
import type { ChatContextCard } from "../../lib/chat/context-cards";
import { formatMeetingElapsed } from "../../lib/meeting/meeting-bridge";

type Props = {
  card: ChatContextCard;
  compact?: boolean;
};

function imageSrc(path: string): string {
  if (!isTauriRuntime()) return "";
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

export function ChatContextCardView({ card, compact }: Props) {
  if (card.kind === "meeting") {
    return (
      <div
        className={[
          "rounded-[var(--radius-md)] border border-[var(--brand-color)]/25 bg-[var(--brand-tint-8)]",
          compact ? "px-3 py-2" : "px-4 py-3",
        ].join(" ")}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--brand-color)]">
          <span aria-hidden>📝</span>
          <span>会议纪要</span>
        </div>
        <div className={`mt-1 font-medium text-[var(--text-primary)] ${compact ? "text-sm" : "text-base"}`}>
          {card.title}
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
          {formatMeetingElapsed(card.elapsedMs)}
          {" · "}
          {card.digestCount} 阶段
          {" · "}
          {card.segmentCount} 段转写
          {card.speakers?.length ? ` · ${card.speakers.join(" / ")}` : ""}
        </div>
        {card.summaryPreview && !compact ? (
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            {card.summaryPreview}
          </p>
        ) : null}
      </div>
    );
  }

  const src = imageSrc(card.path);
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border border-[var(--separator)] bg-[var(--bg-elevated)] overflow-hidden",
        compact ? "max-w-xs" : "max-w-sm",
      ].join(" ")}
    >
      {src ? (
        <img src={src} alt="" className="aspect-video w-full object-cover bg-[var(--surface-glass)]" />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-[var(--surface-glass)] text-xs text-[var(--text-tertiary)]">
          图片预览
        </div>
      )}
      <div className={compact ? "px-3 py-2" : "px-4 py-3"}>
        <div className="text-xs font-semibold text-[var(--text-secondary)]">作图结果</div>
        <p className="mt-1 line-clamp-2 text-sm text-[var(--text-primary)]">{card.prompt}</p>
        {(card.model || card.size) && (
          <div className="mt-1 text-[10px] text-[var(--text-tertiary)]">
            {[card.model, card.size].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

type StripProps = {
  cards: ChatContextCard[];
  onRemove?: (index: number) => void;
};

export function ChatContextCardStrip({ cards, onRemove }: StripProps) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {cards.map((card, i) => (
        <div key={`${card.kind}-${i}`} className="relative">
          <ChatContextCardView card={card} compact />
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--separator)] bg-[var(--bg-elevated)] text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              aria-label="移除卡片"
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
