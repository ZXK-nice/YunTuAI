import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import { agentColor } from "../ui/AgentAvatar";
import type { AgentInfo } from "../../lib/openclaw/agent-rpc";

const VISIBLE_CHIP_MAX = 3;

function splitAgentsForHeader(agents: AgentInfo[], activeId: string | null) {
  if (agents.length <= VISIBLE_CHIP_MAX) {
    return { visible: agents, overflow: [] as AgentInfo[] };
  }
  const active = agents.find((a) => a.id === activeId);
  const rest = agents.filter((a) => a.id !== activeId);
  const visible: AgentInfo[] = [];
  if (active) visible.push(active);
  for (const a of rest) {
    if (visible.length >= 2) break;
    visible.push(a);
  }
  const visibleIds = new Set(visible.map((a) => a.id));
  return {
    visible,
    overflow: agents.filter((a) => !visibleIds.has(a.id)),
  };
}

function AgentChip({
  agent,
  active,
  onSelect,
}: {
  agent: AgentInfo;
  active: boolean;
  onSelect: () => void;
}) {
  const color = agentColor(agent.id);
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`切换到 ${agent.name}`}
      aria-pressed={active}
      className={[
        "app-header-agent-chip",
        active && agent.id === "main"
          ? "app-header-agent-chip--active-tonal"
          : active
            ? "app-header-agent-chip--active"
            : "",
      ].join(" ")}
      style={{ "--agent-chip-color": color } as CSSProperties}
    >
      <span className="app-header-agent-chip__dot app-header-agent-chip__dot--agent" aria-hidden />
      <span className="max-w-[4.5rem] truncate">{agent.name}</span>
    </button>
  );
}

export const HeaderAgentSwitcher = memo(function HeaderAgentSwitcher() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const connState = useGatewayStore((s) => s.connState);
  const showToast = useUiStore((s) => s.showToast);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const { visible, overflow } = useMemo(
    () => splitAgentsForHeader(agents, activeAgentId),
    [agents, activeAgentId],
  );

  useEffect(() => {
    if (!overflowOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  if (agents.length === 0) return null;

  const onPick = (id: string) => {
    if (id === activeAgentId) return;
    selectAgent(id);
    const name = agents.find((a) => a.id === id)?.name ?? id;
    showToast(`已切换到「${name}」`, "success");
    setOverflowOpen(false);
  };

  return (
    <div
      className="flex max-w-[min(100%,14rem)] items-center gap-1"
      role="group"
      aria-label="切换 Agent"
    >
      {visible.map((a) => (
        <AgentChip
          key={a.id}
          agent={a}
          active={a.id === activeAgentId}
          onSelect={() => onPick(a.id)}
        />
      ))}
      {overflow.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOverflowOpen((o) => !o)}
            aria-expanded={overflowOpen}
            aria-haspopup="listbox"
            className={[
              "app-header-agent-chip app-header-agent-chip--more",
              overflow.some((a) => a.id === activeAgentId) ? "app-header-agent-chip--active" : "",
            ].join(" ")}
            title="更多 Agent"
          >
            +{overflow.length}
          </button>
          {overflowOpen && (
            <div
              role="listbox"
              aria-label="更多 Agent"
              className="absolute right-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-lg"
            >
              {overflow.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="option"
                  aria-selected={a.id === activeAgentId}
                  onClick={() => onPick(a.id)}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                    a.id === activeAgentId
                      ? "bg-[var(--brand-surface-select)] font-medium text-[var(--brand-color)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  ].join(" ")}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: agentColor(a.id) }}
                    aria-hidden
                  />
                  <span className="truncate">{a.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {connState !== "connected" && agents.length > 0 && (
        <span className="sr-only">助手列表已加载，等待本机服务连接</span>
      )}
    </div>
  );
});
