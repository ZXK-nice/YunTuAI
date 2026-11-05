import { memo, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  text: string;
  /** 是否正在流式输出思考内容 */
  streaming?: boolean;
  /** 完成后的默认折叠状态 */
  defaultCollapsed?: boolean;
  /** 思考完成时回调（如正文开始输出时自动折叠） */
  onThinkingDone?: () => void;
};

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ${
        open ? "rotate-0" : "-rotate-90"
      }`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** 将思考文本转为无序列表格式的行数组。
 *  若已经是列表格式（以 - / * / 数字. 开头），保留原格式；
 *  否则用自然句分割。 */
function formatThinkingLines(raw: string): string[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return ["正在思考…"];

  // 检查是否已经是列表格式
  const isListLike = lines.some((l) => /^[-*\d]/.test(l));
  if (isListLike) return lines;

  // 按句子拆分，每句一行
  const sentences: string[] = [];
  for (const line of lines) {
    // 按中文句号/问号/感叹号 + 英文句号分割
    const parts = line.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }
  return sentences.length > 0 ? sentences : [raw.trim()];
}

/** 估计思考文本对应的思考时长（秒）。
 *  streaming=true 时从首次渲染起计时；
 *  streaming=false 时从文本长度推算（约 20 字/秒）。 */
function estimateThinkingSeconds(
  text: string,
  streaming: boolean,
  startedAt: React.MutableRefObject<number>,
): number {
  if (streaming) {
    return Math.floor((Date.now() - startedAt.current) / 1000);
  }
  // 已完成的思考：按字数反推，最少 1s
  const charCount = text.length;
  return Math.max(1, Math.round(charCount / 20));
}

/** 思考过程可折叠块 — 类似 DeepSeek 的「🧠 深度思考」。 */
export const ThinkingBlock = memo(function ThinkingBlock({
  text,
  streaming = false,
  defaultCollapsed = false,
  onThinkingDone,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [done, setDone] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 流式停止时标记完成
  useEffect(() => {
    if (!streaming && text && !done) {
      setDone(true);
      // 停止后自动折叠
      setCollapsed(true);
      onThinkingDone?.();
    }
  }, [streaming, text, done, onThinkingDone]);

  // 实时计时（仅 streaming 时）
  useEffect(() => {
    if (streaming) {
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAt.current) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [streaming]);

  // 非 streaming 时一次性估算
  useEffect(() => {
    if (!streaming) {
      setSeconds(estimateThinkingSeconds(text, false, startedAt));
    }
  }, [text, streaming]);

  const lines = useMemo(() => formatThinkingLines(text), [text]);

  // 流式输出中即使还没有文字也要显示占位块（避免「思考中但看不到」的问题）
  if (!text?.trim() && !streaming) return null;

  const summary = done || !streaming
    ? `已思考 ${seconds} 秒`
    : `思考中 ${seconds} 秒…`;

  return (
    <div className="thinking-block relative mb-4 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      {/* 标题栏 */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <span className="text-base" aria-hidden>🧠</span>
        <span className="flex-1 text-xs font-semibold text-[var(--text-secondary)]">
          深度思考
        </span>
        <span className="mr-1 text-[10px] text-[var(--text-muted)] whitespace-nowrap">
          {summary}
        </span>
        <ChevronDown open={!collapsed} />
      </button>

      {/* 可折叠内容 — 淡灰引用块风格 */}
      <div
        ref={bodyRef}
        className={`overflow-hidden transition-all duration-300 ease-out ${
          collapsed ? "max-h-0 opacity-0" : "max-h-[5000px] opacity-100"
        }`}
      >
        <div className="mx-3.5 mb-3 rounded-[var(--radius-sm)] bg-[var(--bg-hover)] px-3.5 py-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          {lines.map((line, i) => {
            // 检测是否已以列表标记开头
            const isListItem = /^[-*\d]/.test(line);
            const prefix = isListItem ? "" : "• ";
            return (
              <div key={i} className="py-0.5">
                {prefix}
                {line}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
