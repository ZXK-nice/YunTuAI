import { memo, type ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
};

export const SettingsSectionFrame = memo(function SettingsSectionFrame({
  id,
  title,
  description,
  children,
}: Props) {
  return (
    <section id={id} className="scroll-mt-4 space-y-4">
      <div className="border-b border-[var(--border-subtle)] pb-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
});
