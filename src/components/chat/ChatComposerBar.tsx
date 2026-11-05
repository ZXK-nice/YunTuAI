import { memo, type RefObject } from "react";
import { ModelSelector } from "./ModelSelector";
import { DeepThinkingToggle } from "./DeepThinkingToggle";

export type PendingAttachmentChip = {
  id: string;
  name: string;
  size?: number;
  extractStatus?: "pending" | "extracting" | "ocr_ok" | "ocr_empty" | "ocr_fail" | "office_ok" | "office_fail";
  extractHint?: string;
};

type Props = {
  draft: string;
  onDraftChange: (value: string) => void;
  draftRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  /** 空态居中于提示下方；有输入/附件或已有消息后沉底 */
  layout?: "inline" | "bottom";
  composerDisabled: boolean;
  sendDisabled: boolean;
  composerDisabledReason?: string;
  canAttachFiles: boolean;
  hasContextCards?: boolean;
  busy: boolean;
  voiceListening: boolean;
  voiceChecking?: boolean;
  voiceInterim?: string;
  pendingAttachments: PendingAttachmentChip[];
  onRemoveAttachment: (id: string) => void;
  /** 回形针：选择本地文件作为附件 */
  onAttachFiles: () => void;
  /** 麦克风：浏览器语音听写 */
  onToggleVoice: () => void;
  /** 发送或停止生成 */
  onPrimaryAction: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** 仅本机执行：禁止 Agent 联网/外发 */
  localOnlyMode?: boolean;
  onToggleLocalOnly?: () => void;
  localOnlySuggest?: boolean;
};

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

function IconAttach({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function IconMic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v4M8 23h8" />
    </svg>
  );
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function ComposerToolBtn({
  label,
  title,
  disabled,
  active,
  busy,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  active?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
      className={[
        "chat-composer-tool-btn",
        active ? "chat-composer-tool-btn--active" : "",
        disabled ? "opacity-50" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export const ChatComposerBar = memo(function ChatComposerBar({
  draft,
  onDraftChange,
  draftRef,
  placeholder,
  layout = "bottom",
  composerDisabled,
  sendDisabled,
  composerDisabledReason,
  canAttachFiles,
  hasContextCards = false,
  busy,
  voiceListening,
  voiceChecking = false,
  voiceInterim = "",
  pendingAttachments,
  onRemoveAttachment,
  onAttachFiles,
  onToggleVoice,
  onPrimaryAction,
  fileInputRef,
  onFileInputChange,
  localOnlyMode = false,
  onToggleLocalOnly,
  localOnlySuggest = false,
}: Props) {
  const canSend = !!draft.trim() || pendingAttachments.length > 0 || hasContextCards;
  const inputPlaceholder = voiceListening
    ? voiceInterim.trim()
      ? `听写中：${voiceInterim.trim()}`
      : "正在听写，请说话…"
    : placeholder;

  return (
    <div
      className={[
        "chat-composer-dock",
        layout === "inline" ? "chat-composer-dock--inline" : "chat-composer-dock--bottom",
      ].join(" ")}
    >
      {layout === "bottom" ? <div className="chat-composer-fade" aria-hidden /> : null}
      <div className="chat-composer-dock__inner">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={onFileInputChange}
        />

        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1" aria-label="待发送附件">
            {pendingAttachments.map((a) => (
              <span
                key={a.id}
                className="yt-chip-enter inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-full)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2.5 pr-1 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-xs)]"
              >
                <span className="min-w-0 truncate" title={a.name}>
                  {a.name}
                </span>
                {a.extractHint ? (
                  <span
                    className={[
                      "shrink-0 rounded-[var(--radius-full)] px-1.5 py-0.5 text-[10px]",
                      a.extractStatus === "ocr_fail" || a.extractStatus === "ocr_empty" || a.extractStatus === "office_fail"
                        ? "bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]"
                        : a.extractStatus === "extracting"
                          ? "text-[var(--text-tertiary)]"
                          : "bg-[color-mix(in_oklab,var(--brand-color)_10%,transparent)] text-[var(--brand-color)]",
                    ].join(" ")}
                  >
                    {a.extractHint}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="yt-press shrink-0 rounded-[var(--radius-full)] px-1.5 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"
                  aria-label={`移除附件 ${a.name}`}
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="chat-composer-bar">
          <div className="flex shrink-0 items-center gap-0.5">
            <ComposerToolBtn
              label="添加附件"
              title={canAttachFiles ? "添加附件（也可拖入文件）" : "请先选择会话"}
              disabled={!canAttachFiles}
              onClick={onAttachFiles}
            >
              <IconAttach className="h-[18px] w-[18px]" />
            </ComposerToolBtn>

            {onToggleLocalOnly ? (
              <ComposerToolBtn
                label={localOnlyMode ? "已开启仅本机执行" : "开启仅本机执行"}
                title={
                  localOnlyMode
                    ? "仅本机执行已开启：Agent 不会联网或外发数据"
                    : localOnlySuggest
                      ? "建议开启：当前内容可能含敏感信息，仅在本机处理"
                      : "仅本机执行：禁止联网搜索与外发，适合财务/合同等敏感任务"
                }
                active={localOnlyMode}
                onClick={onToggleLocalOnly}
              >
                <IconShield className="h-[18px] w-[18px]" />
              </ComposerToolBtn>
            ) : null}

            <ModelSelector disabled={composerDisabled} />

            <DeepThinkingToggle disabled={composerDisabled} />
          </div>

          {localOnlyMode ? (
            <p className="mb-1 px-1 text-[10px] text-[var(--color-warn)]">
              仅本机模式：Agent 将避免联网与外发操作
            </p>
          ) : localOnlySuggest ? (
            <p className="mb-1 px-1 text-[10px] text-[var(--text-tertiary)]">
              检测到可能含敏感信息，可点盾牌开启「仅本机执行」
            </p>
          ) : null}

          <textarea
            ref={draftRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!busy && (sendDisabled || !canSend)) return;
                onPrimaryAction();
              }
            }}
            placeholder={inputPlaceholder}
            rows={1}
            disabled={composerDisabled}
            aria-label="消息输入框"
            className="chat-composer-textarea min-h-[44px] max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent px-2 py-2.5 text-sm leading-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:opacity-55"
          />

          <div className="flex shrink-0 items-center gap-1 pr-0.5">
            <ComposerToolBtn
              label={
                voiceChecking
                  ? "正在检查麦克风…"
                  : voiceListening
                    ? "停止语音听写"
                    : "语音听写"
              }
              title={
                composerDisabled
                  ? composerDisabledReason ?? "请先选择会话"
                  : voiceChecking
                    ? "正在检查麦克风权限…"
                    : voiceListening
                      ? "点击停止听写"
                      : "语音听写（需允许麦克风）"
              }
              disabled={composerDisabled}
              busy={voiceChecking}
              active={voiceListening}
              onClick={onToggleVoice}
            >
              <IconMic className="h-[18px] w-[18px]" />
            </ComposerToolBtn>

            <button
              type="button"
              disabled={busy ? false : sendDisabled || !canSend}
              onClick={onPrimaryAction}
              aria-busy={busy}
              aria-label={busy ? "停止生成" : "发送消息"}
              title={
                busy
                  ? "停止"
                  : sendDisabled
                    ? composerDisabledReason ?? "当前无法发送"
                    : "发送"
              }
              className={[
                "chat-composer-send yt-transition",
                busy ? "chat-composer-send--stop" : "",
                !busy && canSend && !sendDisabled ? "chat-composer-send--ready" : "",
              ].join(" ")}
            >
              {busy ? (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              ) : (
                <IconSend className="h-[17px] w-[17px]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
