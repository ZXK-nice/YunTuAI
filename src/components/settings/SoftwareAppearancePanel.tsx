import { memo, useCallback } from "react";
import {
  HEADER_NAV_MODE_LABELS,
  HEADER_NAV_MODES,
  headerNavModeToLevel,
} from "../../lib/layout-prefs";
import { useUiStore } from "../../stores/uiStore";

export const SoftwareAppearancePanel = memo(function SoftwareAppearancePanel() {
  const colorScheme = useUiStore((s) => s.colorScheme);
  const setColorScheme = useUiStore((s) => s.setColorScheme);
  const headerNavMode = useUiStore((s) => s.headerNavMode);
  const setHeaderNavLevel = useUiStore((s) => s.setHeaderNavLevel);

  const headerLevel = headerNavModeToLevel(headerNavMode);
  const onHeaderSlider = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHeaderNavLevel(Number(e.target.value));
    },
    [setHeaderNavLevel],
  );

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">外观与布局</div>

      <div className="mt-4">
        <div className="text-xs font-medium text-[var(--text-secondary)]">配色</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              { id: "light" as const, label: "浅色" },
              { id: "dark" as const, label: "深色" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setColorScheme(opt.id)}
              className={
                colorScheme === opt.id
                  ? "rounded-lg border border-[var(--border-default)] bg-[var(--bg-active)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
                  : "yt-btn-svc"
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        <label className="block text-xs font-medium text-[var(--text-secondary)]" htmlFor="header-nav-mode-slider">
          顶部导航栏 · {HEADER_NAV_MODE_LABELS[headerNavMode]}
        </label>
        <input
          id="header-nav-mode-slider"
          type="range"
          min={0}
          max={HEADER_NAV_MODES.length - 1}
          step={1}
          value={headerLevel}
          onChange={onHeaderSlider}
          className="yt-appearance-slider mt-3 w-full"
          style={{ ["--slider-fill" as string]: `${(headerLevel / (HEADER_NAV_MODES.length - 1)) * 100}%` }}
          aria-valuetext={HEADER_NAV_MODE_LABELS[headerNavMode]}
        />
        <div className="mt-2 flex justify-between text-[10px] text-[var(--text-muted)]">
          {HEADER_NAV_MODES.map((mode) => (
            <span
              key={mode}
              className={mode === headerNavMode ? "font-medium text-[var(--text-primary)]" : undefined}
            >
              {HEADER_NAV_MODE_LABELS[mode]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});
