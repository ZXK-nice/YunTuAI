import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  beautifyChineseText,
  detectCalloutKind,
} from "../../lib/chat/beautify-chinese-text";

/** 仅允许安全的外链协议，阻断 javascript:/file:/data: 等注入向量。 */
function safeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // 相对/协议相对链接（无冒号方案）视为安全的应用内锚点。
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return null;
}

function renderInline(text: string, key: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`${key}-pre-${m.index}`}>{text.slice(last, m.index)}</span>);
    if (m[2]) parts.push(<strong key={`${key}-b-${m.index}`}>{m[2]}</strong>);
    else if (m[3]) parts.push(<strong key={`${key}-u-${m.index}`}>{m[3]}</strong>);
    else if (m[4]) parts.push(<code key={`${key}-c-${m.index}`}>{m[4]}</code>);
    else if (m[5] && m[6]) {
      const safeHref = safeLinkHref(m[6]);
      if (safeHref) {
        parts.push(
          <a key={`${key}-a-${m.index}`} href={safeHref} target="_blank" rel="noreferrer">
            {m[5]}
          </a>,
        );
      } else {
        // 非法协议：降级为纯文本，保留链接文字但不产生可点击的危险链接。
        parts.push(<span key={`${key}-a-${m.index}`}>{m[5]}</span>);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`${key}-tail`}>{text.slice(last)}</span>);
  return parts.length ? parts : text;
}

function IconChevronCode({ up, className }: { up: boolean; className?: string }) {
  return (
    <svg
      className={`${className} ${up ? "rotate-0" : "rotate-180"}`}
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

const CodeBlock = memo(function CodeBlock({
  code,
  language,
}: {
  code: string;
  id: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const lines = code.split("\n");
  const shouldCollapse = lines.length > 12;
  const label = language?.trim() || "代码";

  return (
    <div className={`chat-code-block ${collapsed ? "is-collapsed" : ""}`}>
      <div className="chat-code-toolbar">
        <span className="chat-code-label">{label}</span>
        <div className="flex items-center gap-1">
          {shouldCollapse && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="chat-code-header-btn"
              title={collapsed ? "展开" : "收起"}
            >
              <IconChevronCode up={!collapsed} className="h-3.5 w-3.5" />
            </button>
          )}
          <button type="button" onClick={() => void copy()} className="chat-code-header-btn" title="复制">
            {copied ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 0 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0Z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h5A1.5 1.5 0 0 1 15 3.5v5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 7 8.5v-5Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v5A1.5 1.5 0 0 0 4.5 14h5a1.5 1.5 0 0 0 1.5-1.5V7.5A1.5 1.5 0 0 0 9.5 6h-5Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
});

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  if (cells.length < 2) return null;
  return cells;
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s\-:|]+\|[\s\-:|]+\|?$/.test(line.trim());
}

type Variant = "user" | "assistant" | "system";

const MARKDOWN_CACHE_MAX = 240;
const markdownNodeCache = new Map<string, React.ReactNode[]>();

function markdownCacheKey(text: string, variant: Variant): string {
  return `${variant}\u0000${text}`;
}

function getCachedMarkdownNodes(text: string, variant: Variant): React.ReactNode[] {
  const key = markdownCacheKey(text, variant);
  const hit = markdownNodeCache.get(key);
  if (hit) return hit;
  const nodes = buildMarkdownNodes(text, variant);
  if (markdownNodeCache.size >= MARKDOWN_CACHE_MAX) {
    const first = markdownNodeCache.keys().next().value;
    if (first) markdownNodeCache.delete(first);
  }
  markdownNodeCache.set(key, nodes);
  return nodes;
}

function buildMarkdownNodes(text: string, variant: Variant): React.ReactNode[] {
  const normalized = beautifyChineseText(text);
  const lines = normalized.split("\n");
  const nodes: React.ReactNode[] = [];
  let listBuf: string[] = [];
  let olBuf: string[] = [];
  let quoteBuf: string[] = [];
  let codeBuf: string[] = [];
  let tableBuf: string[] = [];
  let inCode = false;
  let codeLang = "";
  let paragraphIndex = 0;

  const flushList = (i: number) => {
    if (!listBuf.length) return;
    nodes.push(
      <ul key={`${variant}-ul-${i}`} className="chat-md-list">
        {listBuf.map((l, idx) => {
          const task = l.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
          if (task) {
            const checked = task[1]?.toLowerCase() === "x";
            const body = task[2] ?? "";
            return (
              <li key={`${variant}-li-${i}-${idx}`} className={checked ? "is-done" : undefined}>
                <span className="chat-md-task" aria-hidden>
                  {checked ? "☑" : "☐"}
                </span>
                {renderInline(body, `${variant}-li-${i}-${idx}`)}
              </li>
            );
          }
          return (
            <li key={`${variant}-li-${i}-${idx}`}>
              {renderInline(l.replace(/^[-*]\s+/, ""), `${variant}-li-${i}-${idx}`)}
            </li>
          );
        })}
      </ul>,
    );
    listBuf = [];
  };

  const flushOl = (i: number) => {
    if (!olBuf.length) return;
    nodes.push(
      <ol key={`${variant}-ol-${i}`} className="chat-md-ordered">
        {olBuf.map((l, idx) => (
          <li key={`${variant}-oli-${i}-${idx}`}>
            {renderInline(l.replace(/^\d+\.\s+/, ""), `${variant}-oli-${i}-${idx}`)}
          </li>
        ))}
      </ol>,
    );
    olBuf = [];
  };

  const flushQuote = (i: number) => {
    if (!quoteBuf.length) return;
    const first = quoteBuf[0] ?? "";
    const callout = detectCalloutKind(first);
    const body = quoteBuf.map((l) => l.replace(/^>\s?/, "").trim()).join("\n");
    if (callout) {
      nodes.push(
        <div key={`${variant}-callout-${i}`} className={`chat-md-callout chat-md-callout--${callout}`}>
          {body.split("\n").map((ln, idx) => (
            <p key={`${variant}-callout-${i}-${idx}`}>{renderInline(ln, `${variant}-callout-${i}-${idx}`)}</p>
          ))}
        </div>,
      );
    } else {
      nodes.push(
        <blockquote key={`${variant}-quote-${i}`} className="chat-md-quote">
          {body.split("\n").map((ln, idx) => (
            <p key={`${variant}-quote-${i}-${idx}`}>{renderInline(ln, `${variant}-quote-${i}-${idx}`)}</p>
          ))}
        </blockquote>,
      );
    }
    quoteBuf = [];
  };

  const flushCode = (i: number) => {
    if (!codeBuf.length) return;
    const code = codeBuf.join("\n");
    nodes.push(
      <CodeBlock
        key={`${variant}-code-${i}`}
        code={code}
        id={`${variant}-code-${i}`}
        language={codeLang}
      />,
    );
    codeBuf = [];
    codeLang = "";
  };

  const flushTable = (i: number) => {
    if (tableBuf.length < 2) {
      tableBuf.forEach((ln, idx) => {
        nodes.push(
          <p key={`${variant}-tbl-fallback-${i}-${idx}`} className="chat-md-p">
            {renderInline(ln, `${variant}-tbl-fallback-${i}-${idx}`)}
          </p>,
        );
      });
      tableBuf = [];
      return;
    }
    const headerLine = tableBuf[0];
    if (!headerLine) {
      tableBuf = [];
      return;
    }
    const header = parseTableRow(headerLine);
    const bodyRows = tableBuf.slice(2).map(parseTableRow).filter(Boolean) as string[][];
    if (!header) {
      tableBuf = [];
      return;
    }
    nodes.push(
      <div key={`${variant}-table-${i}`} className="chat-md-table-wrap">
        <table className="chat-md-table">
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={`${variant}-th-${i}-${ci}`}>{renderInline(cell, `${variant}-th-${i}-${ci}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={`${variant}-tr-${i}-${ri}`}>
                {row.map((cell, ci) => (
                  <td key={`${variant}-td-${i}-${ri}-${ci}`}>
                    {renderInline(cell, `${variant}-td-${i}-${ri}-${ci}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableBuf = [];
  };

  const flushAllBlocks = (i: number) => {
    flushList(i);
    flushOl(i);
    flushQuote(i);
    flushTable(i);
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushAllBlocks(i);
        inCode = true;
        codeLang = trimmed.slice(3).trim();
      } else {
        inCode = false;
        flushCode(i);
      }
      return;
    }
    if (inCode) {
      codeBuf.push(line);
      return;
    }

    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      flushAllBlocks(i);
      nodes.push(<hr key={`${variant}-hr-${i}`} className="chat-md-hr" />);
      return;
    }

    const tableRow = parseTableRow(line);
    const nextSep = i + 1 < lines.length && isTableSeparator(lines[i + 1] ?? "");
    if (tableRow && (tableBuf.length > 0 || nextSep)) {
      flushList(i);
      flushOl(i);
      flushQuote(i);
      tableBuf.push(line);
      return;
    }
    if (tableBuf.length) flushTable(i);

    if (/^>\s?/.test(line)) {
      flushList(i);
      flushOl(i);
      quoteBuf.push(line);
      return;
    }
    if (quoteBuf.length) flushQuote(i);

    const isLi = /^[-*]\s+/.test(line);
    const isOl = /^\d+\.\s+/.test(line);
    if (isLi) {
      flushOl(i);
      listBuf.push(line);
      return;
    }
    if (isOl) {
      flushList(i);
      olBuf.push(line);
      return;
    }

    flushAllBlocks(i);

    if (trimmed === "") return;

    const h3 = trimmed.match(/^###\s+(.+)$/);
    const h2 = trimmed.match(/^##\s+(.+)$/);
    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      nodes.push(
        <h3 key={`${variant}-h1-${i}`} className="chat-md-h1">
          {renderInline(h1[1]!, `${variant}-h1-${i}`)}
        </h3>,
      );
      return;
    }
    if (h2) {
      nodes.push(
        <h4 key={`${variant}-h2-${i}`} className="chat-md-h2">
          {renderInline(h2[1]!, `${variant}-h2-${i}`)}
        </h4>,
      );
      return;
    }
    if (h3) {
      nodes.push(
        <h5 key={`${variant}-h3-${i}`} className="chat-md-h3">
          {renderInline(h3[1]!, `${variant}-h3-${i}`)}
        </h5>,
      );
      return;
    }

    const isFirstParagraph = paragraphIndex === 0;
    paragraphIndex += 1;
    nodes.push(
      <p
        key={`${variant}-p-${i}`}
        className={[
          "chat-md-p",
          isFirstParagraph ? "chat-md-p--lead" : "",
          variant === "user" ? "chat-md-p--user" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {renderInline(line, `${variant}-pt-${i}`)}
      </p>,
    );
  });

  flushAllBlocks(lines.length);
  if (inCode && codeBuf.length) flushCode(lines.length);

  return nodes;
}

export const MessageBody = memo(function MessageBody({
  text,
  variant,
  streaming,
}: {
  text: string;
  variant: Variant;
  /** 流式输出时在末尾显示光标 */
  streaming?: boolean;
}) {
  const nodes = useMemo(
    () => (streaming ? null : getCachedMarkdownNodes(text, variant)),
    [text, variant, streaming],
  );

  if (streaming) {
    return (
      <div className="chat-content-md is-streaming">
        <p className="chat-md-p chat-streaming-plain m-0 whitespace-pre-wrap break-words">
          {beautifyChineseText(text)}
        </p>
        <span className="chat-streaming-cursor" aria-hidden />
      </div>
    );
  }

  return (
    <div className="chat-content-md">
      {nodes}
    </div>
  );
});
