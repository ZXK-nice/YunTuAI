import { chatOpenFile } from "../../lib/chat/chat-files-bridge";
import { fileIconKind, formatFileSize, type MessageFileEntry } from "../../lib/chat/message-files";
import { useUiStore } from "../../stores/uiStore";

type Props = {
  files: MessageFileEntry[];
  variant: "user" | "assistant";
};

function IconFile({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.5L11.5 2H6Zm1 2h3v4h4v8H7V4Z" />
    </svg>
  );
}

export function MessageFileChips({ files }: Props) {
  if (!files.length) return null;

  return (
    <div
      className="mb-2 flex flex-wrap justify-start gap-2"
      aria-label="附件"
    >
      {files.map((f) => {
        const sizeLabel = formatFileSize(f.size);
        const kind = fileIconKind(f.name);
        return (
          <button
            key={`${f.path}-${f.name}`}
            type="button"
            title={`打开 ${f.name}${sizeLabel ? `（${sizeLabel}）` : ""} · 使用本机默认程序（如 WPS）`}
            onClick={() => {
              void chatOpenFile(f.path).catch((e) => {
                useUiStore.getState().showToast(e instanceof Error ? e.message : String(e), "error");
              });
            }}
            className={[
              "group inline-flex max-w-full items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-left text-xs transition-colors",
              "border-[color-mix(in_oklab,var(--brand-color)_18%,var(--border-subtle))] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <IconFile className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate font-medium">{f.name}</span>
              {sizeLabel && (
                <span className="block truncate text-[10px] text-[var(--text-muted)]">
                  {kind !== "file" ? `${kind} · ` : ""}
                  {sizeLabel}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
