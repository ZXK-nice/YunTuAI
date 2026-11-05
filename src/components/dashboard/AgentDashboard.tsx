import { memo, useMemo, useState, useCallback, useEffect } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { useAgentStore } from "../../stores/agentStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useStepStore } from "../../stores/stepStore";
import { useUiStore } from "../../stores/uiStore";
import { getGatewayClient } from "../../lib/openclaw/gateway-runtime";
import { createAgent, deleteAgent, formatAgentModelLabel, buildAgentCreateRpcParams, humanizeAgentRpcError, isAgentDeletable } from "../../lib/openclaw/agent-rpc";
import { fetchDistributionProfile } from "../../lib/openclaw/env-bridge";
import { fetchSystemInfo } from "../../lib/system-info-bridge";
import {
  fetchGatewaySkillStatus,
  isUserInstalledGatewaySkill,
  type GatewaySkillInfo,
} from "../../lib/openclaw/gateway-tools";
import { agentColor } from "../ui/AgentAvatar";

const COMMON_MODELS = [
  "deepseek/deepseek-flash",
  "deepseek/deepseek-v4-pro",
  "deepseek-flash",
  "deepseek-v4-pro",
];

function mergeAgentSkillNames(agentSkills: string[], gatewaySkills: GatewaySkillInfo[]): string[] {
  const installed = gatewaySkills.filter(isUserInstalledGatewaySkill).map((s) => s.name);
  return [...new Set([...agentSkills, ...installed])].sort((a, b) => a.localeCompare(b));
}

function IconBot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
}

function IconModel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconSkills({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 4v6h6" />
      <path d="M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M6.5 6.5V15a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V6.5M8 6.5V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M4.5 6.5h11" />
    </svg>
  );
}

function IconPlay({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export const AgentDashboard = memo(function AgentDashboard() {
  const agents = useAgentStore((s) => s.agents);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const evictAgent = useAgentStore((s) => s.evictAgent);
  const agentLoading = useAgentStore((s) => s.loading);
  const sessions = useSessionStore((s) => s.sessions);
  const enterComposeMode = useSessionStore((s) => s.enterComposeMode);
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const connState = useGatewayStore((s) => s.connState);
  const showToast = useUiStore((s) => s.showToast);
  const requestNavToComposeChat = useUiStore((s) => s.requestNavToComposeChat);
  const setActiveAgent = useStepStore((s) => s.setActiveAgent);
  const gatewayOnline = connState === "connected";

  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [newAgentId, setNewAgentId] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentModel, setNewAgentModel] = useState("");
  const [newAgentDescription, setNewAgentDescription] = useState("");
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [gatewaySkills, setGatewaySkills] = useState<GatewaySkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  const loadGatewaySkills = useCallback(async () => {
    if (connState !== "connected") {
      setGatewaySkills([]);
      return;
    }
    setSkillsLoading(true);
    try {
      setGatewaySkills(await fetchGatewaySkillStatus());
    } catch {
      setGatewaySkills([]);
    } finally {
      setSkillsLoading(false);
    }
  }, [connState]);

  const refreshDashboard = useCallback(async () => {
    await Promise.all([loadAgents(), loadSessions(), loadGatewaySkills()]);
  }, [loadAgents, loadGatewaySkills, loadSessions]);

  const dashboardBusy = agentLoading || skillsLoading;

  /* 关闭时重置 */
  const closeCreateDialog = useCallback(() => {
    setCreateAgentOpen(false);
    setNewAgentId("");
    setNewAgentName("");
    setNewAgentModel("");
    setNewAgentDescription("");
  }, []);

  const openCreateDialog = useCallback(() => {
    setCreateAgentOpen(true);
    void fetchDistributionProfile().then((profile) => {
      const full = profile?.defaultModelId?.trim();
      if (full) {
        setNewAgentModel((cur) => cur.trim() ? cur : full);
      }
    });
  }, []);

  const sessionsByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      if (s.agentId) map.set(s.agentId, (map.get(s.agentId) || 0) + 1);
    }
    const unassigned = sessions.filter((s) => !s.agentId).length;
    return { map, unassigned };
  }, [sessions]);

  const totalSessions = sessions.length;
  const totalAgents = agents.length;
  const installedSkillCount = useMemo(
    () => gatewaySkills.filter(isUserInstalledGatewaySkill).length,
    [gatewaySkills],
  );
  const gatewaySkillCount = gatewaySkills.length;

  useEffect(() => {
    if (connState !== "connected") {
      setGatewaySkills([]);
      return;
    }
    void refreshDashboard();
  }, [connState, refreshDashboard]);

  const onSelectAgent = (id: string) => {
    selectAgent(id);
    const agent = agents.find((a) => a.id === id);
    setActiveAgent(id, agent?.name ?? null);
    showToast(`已切换到「${agent?.name ?? id}」`, "success");
  };

  const statCards = [
    { label: "Agent 总数", value: totalAgents, icon: IconBot, color: "var(--brand-color)", gradient: "from-[var(--brand-color)]/10 to-[var(--brand-color)]/5" },
    { label: "总会话", value: totalSessions, icon: IconModel, color: "var(--brand-color-end)", gradient: "from-[var(--brand-color-end)]/10 to-[var(--brand-color-end)]/5" },
    { label: "已装技能", value: installedSkillCount, icon: IconSkills, color: "var(--color-success)", gradient: "from-[var(--color-success)]/10 to-[var(--color-success)]/5" },
    { label: "未分类", value: sessionsByAgent.unassigned, icon: IconSkills, color: "var(--color-warn)", gradient: "from-[var(--color-warn)]/10 to-[var(--color-warn)]/5" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">Agent 指挥中心</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">管理、切换与监控本机多个 Agent 的运行状态与任务派发</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            disabled={dashboardBusy || connState !== "connected"}
            className="yt-press dashboard-btn flex items-center gap-2"
          >
            <IconRefresh className={`h-4 w-4 ${dashboardBusy ? "animate-spin" : ""}`} />
            {dashboardBusy ? "刷新中…" : "刷新列表"}
          </button>
          <button
            type="button"
            onClick={openCreateDialog}
            disabled={connState !== "connected"}
            className="yt-press dashboard-btn-primary flex items-center gap-2"
          >
            创建 Agent
          </button>
        </div>
      </div>

      {gatewayOnline && gatewaySkillCount > 0 ? (
        <p className="mb-4 text-[11px] text-[var(--text-muted)]">
          本机服务可见 {gatewaySkillCount} 个技能（含内置）；已装技能统计工作区/同步目录中的 {installedSkillCount} 个。
        </p>
      ) : null}

      <div className="mb-6 grid grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="agent-stat-card flex items-center gap-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-white shadow-sm"
              style={{ backgroundColor: card.color }}
            >
              <card.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{card.label}</p>
              <p className="mt-0.5 text-[26px] font-bold tracking-tight text-[var(--text-primary)] tabular-nums">{card.value}</p>
            </div>
          </div>
        ))}
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="yt-empty-state max-w-sm">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--bg-hover)]">
              <IconBot className="h-10 w-10 text-[var(--text-muted)]" />
            </div>
            <h3 className="mt-5 text-base font-semibold text-[var(--text-primary)]">尚未发现 Agent</h3>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
              {connState === "connected"
                ? "请先连接本机服务，然后点击上方「刷新列表」获取。"
                : "请先连接到本机服务，然后刷新助手列表。"}
            </p>
            {connState !== "connected" && (
              <button
                type="button"
                onClick={() => void connectWithFeedback("连接")}
                disabled={connState === "connecting"}
                className="dashboard-btn-primary mt-5 disabled:opacity-50"
              >
                {connState === "connecting" ? "连接中…" : "连接本机服务"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {agents.map((agent) => {
            const isActive = agent.id === activeAgentId;
            const sessionCount = sessionsByAgent.map.get(agent.id) || 0;
            const isExpanded = expandedAgentId === agent.id;
            const color = agentColor(agent.id);
            const agentSkillNames = mergeAgentSkillNames(agent.skills, gatewaySkills);

            return (
              <div
                key={agent.id}
                className={["agent-card rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6", isActive ? "agent-card-active" : ""].join(" ")}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <div
                        className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] text-base font-bold text-white shadow-md"
                        style={{ backgroundColor: color }}
                      >
                        {agent.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span
                        className={[
                          "agent-status-dot",
                          gatewayOnline ? "agent-status-dot--online" : "agent-status-dot--offline",
                        ].join(" ")}
                        title={gatewayOnline ? "本机服务已连接" : "本机服务未连接"}
                        aria-label={gatewayOnline ? "本机服务已连接" : "本机服务未连接"}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="truncate text-base font-bold text-[var(--text-primary)]">{agent.name}</h3>
                        {agent.isDefault && (
                          <span className="shrink-0 rounded-md bg-[var(--brand-tint-12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-color)]">默认</span>
                        )}
                        {isActive && (
                          <span className="shrink-0 rounded-md bg-[color-mix(in_oklab,var(--color-success)_12%,var(--bg-elevated))] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-success)]">当前</span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-1">
                        {formatAgentModelLabel(agent.model)}
                        {agent.provider ? ` · ${agent.provider}` : ""}
                      </p>
                      {agent.description && (
                        <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)] line-clamp-2">{agent.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isAgentDeletable(agent) ? (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget({ id: agent.id, name: agent.name })}
                        disabled={connState !== "connected" || deletingAgent}
                        className="yt-press flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-error)_25%,var(--border-subtle))] text-[var(--color-error)] transition-colors hover:bg-[color-mix(in_oklab,var(--color-error)_8%,var(--bg-elevated))] disabled:opacity-50"
                        title={`删除 Agent「${agent.name}」`}
                        aria-label={`删除 Agent「${agent.name}」`}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onSelectAgent(agent.id)}
                      disabled={isActive}
                      className={[
                        "yt-press shrink-0 rounded-[var(--radius-md)] px-4 py-2 text-xs font-semibold transition-all duration-200",
                        isActive
                          ? "bg-[var(--brand-surface-select)] text-[var(--brand-color)] cursor-default shadow-sm"
                          : "bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--brand-surface-select)] hover:text-[var(--brand-color)] hover:shadow-sm",
                      ].join(" ")}
                    >
                      {isActive ? "使用中" : "切换到此"}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  {[
                    { label: "会话", value: sessionCount },
                    { label: "Skills", value: agentSkillNames.length },
                    { label: "沙箱", value: agent.sandboxMode === "off" || !agent.sandboxMode ? "关闭" : agent.sandboxMode },
                  ].map((item) => (
                    <div key={item.label} className="rounded-[var(--radius-md)] bg-[var(--bg-hover)] px-4 py-3 text-center">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{item.label}</p>
                      <p className="mt-0.5 text-lg font-bold tracking-tight text-[var(--text-primary)] tabular-nums">{item.value}</p>
                    </div>
                  ))}
                </div>

                {agentSkillNames.length > 0 && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedAgentId(isExpanded ? null : agent.id)}
                      className="flex w-full items-center gap-1.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      <span>已装技能 ({agentSkillNames.length})</span>
                      <IconChevronDown className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                    {isExpanded && (
                      <div className="mt-3 space-y-1 pl-1">
                        {agentSkillNames.map((skill) => (
                          <div key={skill} className="agent-activity-item">
                            <div className="agent-activity-dot" />
                            <span className="text-xs text-[var(--text-secondary)] leading-relaxed">{skill}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isActive && (
                  <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 text-xs leading-relaxed text-[var(--text-muted)]">
                        {sessionCount > 0
                          ? `当前正使用此 Agent。新建会话将自动关联到「${agent.name}」。`
                          : `此 Agent 暂无关联合话。`}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAgent(agent.id);
                          enterComposeMode();
                          requestNavToComposeChat();
                          showToast(`已切换到「${agent.name}」新对话`, "success");
                        }}
                        className="yt-press dashboard-btn-primary flex shrink-0 items-center gap-1.5 px-4 py-2 text-xs"
                      >
                        <IconPlay className="h-3 w-3" />
                        新建会话
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除 Agent？"
        titleId="delete-agent-dialog-title"
        variant="danger"
        confirmLabel={deletingAgent ? "删除中…" : "删除"}
        cancelLabel="取消"
        disabled={deletingAgent}
        confirmLoading={deletingAgent}
        onClose={() => {
          if (!deletingAgent) setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { id, name } = deleteTarget;
          setDeletingAgent(true);
          try {
            const client = getGatewayClient();
            if (!client.isHelloOk) {
              throw new Error("本机服务未连接，无法删除助手");
            }
            await deleteAgent((m, p) => client.request(m, p), id);
            evictAgent(id);
            try {
              await loadAgents({ force: true });
            } catch {
              /* 刷新失败不阻塞成功提示 */
            }
            setDeleteTarget(null);
            showToast(`已删除 Agent「${name}」`, "success");
          } catch (e) {
            showToast(humanizeAgentRpcError(e), "error");
          } finally {
            setDeletingAgent(false);
          }
        }}
      >
        <div className="space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          <p>
            将从本机服务删除助手「{deleteTarget?.name ?? ""}」（{deleteTarget?.id ?? ""}）。此操作不可恢复。
          </p>
          {deleteTarget && (sessionsByAgent.map.get(deleteTarget.id) || 0) > 0 ? (
            <p className="text-[var(--color-warn)]">
              该 Agent 下仍有 {sessionsByAgent.map.get(deleteTarget.id)} 条本地会话；删除后这些会话不会自动消失，但侧栏在切换回该
              Agent 前将不再显示。
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={createAgentOpen}
        title="创建新 Agent"
        titleId="create-agent-dialog-title"
        confirmLabel={creatingAgent ? "创建中…" : "确认创建"}
        cancelLabel="取消"
        disabled={creatingAgent}
        confirmLoading={creatingAgent}
        onClose={closeCreateDialog}
        onConfirm={async () => {
          /* 校验：名称 */
          if (!newAgentName.trim()) {
            showToast("Agent 名称不能为空", "error");
            return;
          }
          /* 校验：模型必填 */
          if (!newAgentModel.trim()) {
            showToast("模型不能为空，请指定一个 LLM 模型 ID", "error");
            return;
          }
          setCreatingAgent(true);
          try {
            const client = getGatewayClient();
            if (!client.isHelloOk) {
              throw new Error("本机服务未连接，无法创建助手");
            }
            const sys = await fetchSystemInfo();
            const dataDir = sys?.openclawDataDir?.trim();
            if (!dataDir) {
              throw new Error("无法读取服务数据目录，请重启应用后重试");
            }
            const profile = await fetchDistributionProfile();
            const payload = buildAgentCreateRpcParams(
              {
                displayName: newAgentName.trim(),
                preferredId: newAgentId.trim() || undefined,
                model: newAgentModel.trim(),
                openclawDataDir: dataDir,
              },
              profile?.defaultModelId,
            );
            const created = await createAgent((m, p) => client.request(m, p), payload);
            if (!created) {
              throw new Error("本机服务返回了无效的响应，助手可能未正常创建");
            }
            /* 创建成功后刷新列表（best-effort），失败静默忽略 */
            try {
              await loadAgents({ force: true });
            } catch {
              /* 刷新失败不阻塞成功提示 */
            }
            closeCreateDialog();
            showToast(`已创建 Agent「${created.name || created.id}」`, "success");
          } catch (e) {
            showToast(humanizeAgentRpcError(e), "error");
          } finally {
            setCreatingAgent(false);
          }
        }}
      >
        <div className="space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              Agent 名称 <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              type="text"
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] focus:ring-[color-mix(in_oklab,var(--brand-color)_18%,transparent)]"
              placeholder="例如：智能助手"
              disabled={creatingAgent}
              autoFocus
            />
          </div>

          {/* Agent ID（可选） */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">Agent ID（可选）</label>
            <input
              type="text"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] focus:ring-[color-mix(in_oklab,var(--brand-color)_18%,transparent)]"
              placeholder="英文/数字，如 sales-bot（纯中文名时建议填写）"
              disabled={creatingAgent}
            />
          </div>

          {/* 模型（必填 + 建议列表） */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">
              模型 <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              type="text"
              list="model-suggestions"
              value={newAgentModel}
              onChange={(e) => setNewAgentModel(e.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] focus:ring-[color-mix(in_oklab,var(--brand-color)_18%,transparent)]"
              placeholder="例如：gpt-4o-mini"
              disabled={creatingAgent}
            />
            <datalist id="model-suggestions">
              {COMMON_MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              必填。工作区将自动创建于服务数据目录；模型可从建议列表选择
            </p>
          </div>

          {/* 简介 */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)]">简介（可选）</label>
            <textarea
              value={newAgentDescription}
              onChange={(e) => setNewAgentDescription(e.target.value)}
              className="mt-2 w-full min-h-[96px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] focus:ring-[color-mix(in_oklab,var(--brand-color)_18%,transparent)]"
              placeholder="可写入 Agent 简要说明，便于识别"
              disabled={creatingAgent}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
});
