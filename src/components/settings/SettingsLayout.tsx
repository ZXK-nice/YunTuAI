import { memo, type ReactNode } from "react";
import { SETTINGS_NAV_ITEMS, type SettingsTab } from "../../lib/settings-nav";

type Props = {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  panels: Record<SettingsTab, ReactNode>;
  footer?: ReactNode;
};

export const SettingsLayout = memo(function SettingsLayout({
  activeTab,
  onTabChange,
  panels,
  footer,
}: Props) {
  const active = SETTINGS_NAV_ITEMS.find((item) => item.id === activeTab);

  return (
    <div className="flex min-h-0 flex-col gap-4 text-sm lg:flex-row lg:gap-6">
      <nav
        className="flex shrink-0 gap-1 overflow-x-auto pb-0.5 lg:w-44 lg:flex-col lg:overflow-visible lg:pb-0"
        aria-label="设置分类"
      >
        {SETTINGS_NAV_ITEMS.map((item) => {
          const selected = item.id === activeTab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              aria-current={selected ? "page" : undefined}
              className={[
                "shrink-0 rounded-lg px-3 py-2 text-left transition-colors",
                selected
                  ? "bg-[var(--bg-active)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              <span className="block text-xs font-medium">{item.label}</span>
              <span className="mt-0.5 hidden text-[10px] leading-snug text-[var(--text-tertiary)] lg:block">
                {item.hint}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1">
        {active ? (
          <div className="mb-4 hidden border-b border-[var(--border-subtle)] pb-3 lg:block">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">{active.label}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">{active.hint}</p>
          </div>
        ) : null}
        {active ? (
          <p className="mb-3 text-xs text-[var(--text-tertiary)] lg:hidden">{active.hint}</p>
        ) : null}
        <div className="space-y-4">{panels[activeTab]}</div>
        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
});
