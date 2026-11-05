import { memo } from "react";

/** Pulse animation keyframe */
const pulseStyle = {
  animation: "skeleton-pulse 2s ease-in-out infinite",
} as React.CSSProperties;

type SkeletonProps = {
  className?: string;
  /** "line" | "circle" | "card" | "bubble" */
  variant?: "line" | "circle" | "card" | "bubble";
  width?: string | number;
  height?: string | number;
};

export const Skeleton = memo(function Skeleton({
  className = "",
  variant = "line",
  width,
  height,
}: SkeletonProps) {
  const base =
    "rounded-md bg-[var(--bg-hover)] opacity-50";

  const variantClass = {
    line: "h-4",
    circle: "rounded-full aspect-square",
    card: "h-20",
    bubble: "rounded-xl h-12",
  }[variant];

  return (
    <div
      className={`${base} ${variantClass} ${className}`}
      style={{
        ...pulseStyle,
        width: width ?? (variant === "circle" ? 40 : undefined),
        height: height ?? (variant === "circle" ? 40 : undefined),
      }}
      aria-hidden="true"
    />
  );
});

/** Pre-built skeleton for a chat message. */
export function ChatMessageSkeleton({ isUser }: { isUser?: boolean }) {
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 ${
        isUser ? "flex-row-reverse" : ""
      }`}
    >
      <Skeleton variant="circle" width={32} height={32} />
      <div
        className={`flex flex-col gap-2 max-w-[70%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <Skeleton
          variant="bubble"
          width={isUser ? 180 : 320}
          className="rounded-xl"
        />
        {!isUser && <Skeleton width={200} />}
      </div>
    </div>
  );
}

/** Pre-built skeleton for dashboard agent card. */
export function AgentCardSkeleton() {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" width={36} height={36} />
        <Skeleton width={120} className="h-4" />
      </div>
      <Skeleton width="80%" />
      <Skeleton width="60%" />
      <Skeleton width="40%" className="h-6 mt-2" />
    </div>
  );
}
