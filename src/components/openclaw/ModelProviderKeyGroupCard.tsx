import { useEffect, useState } from "react";
import {
  isCollapsibleOptionalProviderKey,
  keyRequirementLabel,
  type ModelProviderKeyGroup,
} from "../../lib/openclaw/api-key-policy";
import type { EnvKeyRequirement } from "../../lib/openclaw/env-bridge";

type Props = {
  group: ModelProviderKeyGroup;
  keyDef: EnvKeyRequirement;
  value: string;
  onChange: (value: string) => void;
  busy?: boolean;
  /** 设置页展示已配置状态 */
  showConfiguredStatus?: boolean;
  placeholder?: string;
};

export function ModelProviderKeyGroupCard({
  group,
  keyDef,
  value,
  onChange,
  busy = false,
  showConfiguredStatus = false,
  placeholder,
}: Props) {
  const collapsible = isCollapsibleOptionalProviderKey(group.id);
  const [open, setOpen] = useState(
    () => !collapsible || keyDef.configured || value.trim().length > 0,
  );

  useEffect(() => {
    if (value.trim()) setOpen(true);
  }, [value]);

  const headerRow = (
    <>
      <span className="text-xs font-medium text-[var(--text-primary)]">{group.providerLabel}</span>
      <span className="text-[10px] text-[var(--text-muted)]">
        {collapsible && !open ? "选填 · 点击展开" : group.modelHint}
      </span>
    </>
  );

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-3">
      {collapsible ? (
        <button
          type="button"
          className="mb-2 flex w-full items-center justify-between gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          {headerRow}
          <span className="shrink-0 text-[10px] text-[var(--text-muted)]" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </button>
      ) : (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">{headerRow}</div>
      )}

      {(!collapsible || open) && (
        <>
          <div className={showConfiguredStatus ? "flex items-center justify-between gap-2" : undefined}>
            <label
              htmlFor={`api-key-${keyDef.id}`}
              className={[
                "text-xs text-[var(--text-secondary)]",
                showConfiguredStatus ? undefined : "mb-1 block text-[var(--text-tertiary)]",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {keyDef.label}
              <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                {keyRequirementLabel(keyDef)}
              </span>
            </label>
            {showConfiguredStatus ? (
              <span
                className={[
                  "text-[10px]",
                  keyDef.configured ? "text-[var(--color-success)]" : "text-[var(--color-warn)]",
                ].join(" ")}
              >
                {keyDef.configured ? "已配置" : "未配置"}
              </span>
            ) : null}
          </div>
          <input
            id={`api-key-${keyDef.id}`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? `请输入 ${keyDef.label}`}
            className={["yt-input w-full px-3 py-2 text-sm", showConfiguredStatus ? "mt-1" : ""]
              .filter(Boolean)
              .join(" ")}
            disabled={busy}
          />
          {keyDef.hint ? (
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">{keyDef.hint}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
