import type { ReactNode } from "react";
import { useOwnerStore } from "../../stores/ownerStore";
import { OwnerUnlockPanel } from "./OwnerUnlockPanel";

type Props = {
  title?: string;
  description?: string;
  children: ReactNode;
  /** 未解锁时是否仍渲染子内容（仅隐藏敏感操作由子组件自行处理） */
  passthrough?: boolean;
};

export function OwnerGate({ title, description, children, passthrough }: Props) {
  const unlocked = useOwnerStore((s) => s.unlocked);
  const isInitialized = useOwnerStore((s) => s.isInitialized);

  if (!isInitialized) {
    return (
      <div className="flex min-h-[8rem] items-center justify-center text-sm text-[var(--text-tertiary)]">
        检查权限…
      </div>
    );
  }

  if (unlocked || passthrough) {
    return <>{children}</>;
  }

  return (
    <div className="space-y-4">
      {(title || description) && (
        <div>
          {title ? <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2> : null}
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{description}</p>
          ) : null}
        </div>
      )}
      <OwnerUnlockPanel />
    </div>
  );
}
