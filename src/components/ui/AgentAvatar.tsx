import { MAIN_AGENT_COLOR } from "../../lib/agent-colors";

function hashAgent(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const COLOR_PALETTE = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#6366f1",
];

export function agentColor(id: string): string {
  if (id === "main") return MAIN_AGENT_COLOR;
  return COLOR_PALETTE[hashAgent(id) % COLOR_PALETTE.length]!;
}

export { MAIN_AGENT_COLOR };

type Props = {
  agentId: string;
  agentName?: string;
  size?: number;
};

export function AgentAvatar({ agentId, agentName, size = 36 }: Props) {
  const color = agentColor(agentId);
  const label = (agentName ?? agentId).slice(0, 1).toUpperCase() || "?";
  const fontSize = Math.round(size * 0.44);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden
      style={{ minWidth: size, borderRadius: size * 0.3 }}
    >
      <rect x="0" y="0" width="40" height="40" rx="12" fill={color} />
      <text
        x="20"
        y="28"
        textAnchor="middle"
        fill="white"
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="var(--font-sans)"
        style={{ userSelect: "none" }}
      >
        {label}
      </text>
    </svg>
  );
}
