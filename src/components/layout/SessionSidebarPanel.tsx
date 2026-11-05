import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AgentAvatar } from "../ui/AgentAvatar";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { gsap, gsapReveal, prefersReducedMotion, useGSAP } from "../../lib/gsap/setup";

import { formatSessionSidebarTime } from "../../lib/chat/session-sidebar-time";
import { sortSessionsByActivity } from "../../lib/chat/session-sort";
function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
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

function IconPencil({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19H4v-3L16.5 3.5Z" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z" clipRule="evenodd" />
    </svg>
  );
}

type PanelProps = {
  onFocusChat?: () => void;
};

export const SessionSidebarPanel = memo(function SessionSidebarPanel({ onFocusChat }: PanelProps) {
  const {
    sessions,
    activeId,
    selectSession,
    deleteSession,
    renameSession,
    syncRemote,
    refreshSessionSubscription,
    subscribingSessionId,
    subscriptionHealthBySession,
    sessionsLoading,
    setSessionAgent,
  } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      activeId: s.activeId,
      sessionsLoading: s.sessionsLoading,
      selectSession: s.selectSession,
      deleteSession: s.deleteSession,
      renameSession: s.renameSession,
      syncRemote: s.syncRemoteForActive,
      refreshSessionSubscription: s.refreshSessionSubscription,
      subscribingSessionId: s.subscribingSessionId,
      subscriptionHealthBySession: s.subscriptionHealthBySession,
      setSessionAgent: s.setSessionAgent,
    })),
  );

  const connState = useGatewayStore((s) => s.connState) as GatewayConnStateWord;
  const { agents, activeAgentId } = useAgentStore(
    useShallow((s) => ({ agents: s.agents, activeAgentId: s.activeAgentId })),
  );

  const sessionBusy = false;
  const [syncBusy, setSyncBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [agentReassignId, setAgentReassignId] = useState<string | null>(null);
  const [sessionQuery, setSessionQuery] = useState("");
  const showToast = useUiStore((s) => s.showToast);
  const sessionsListRef = useRef<HTMLDivElement>(null);
  const sessionsPrevEmptyRef = useRef(true);
  const [timeTick, setTimeTick] = useState(0);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const active = useMemo(
    () => sessions.find((x) => x.id === activeId) ?? null,
    [sessions, activeId],
  );

  /** 连接就绪后自动绑定办事会话，无需用户手动点同步。 */
  useEffect(() => {
    if (!active?.id || active.remoteSessionKey?.trim() || connState !== "connected") return;
    void syncRemote();
  }, [active?.id, active?.remoteSessionKey, connState, syncRemote]);

  const activeSubHealth = active ? subscriptionHealthBySession[active.id] : undefined;
  const showRefreshGatewaySub = useMemo(
    () =>
      !!active?.remoteSessionKey?.trim() &&
      connState === "connected" &&
      (activeSubHealth === "push_weak" ||
        activeSubHealth === "pending" ||
        subscribingSessionId === active?.id ||
        refreshBusy),
    [active, connState, activeSubHealth, subscribingSessionId, refreshBusy],
  );

  const displaySessions = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    let list = sessions;
    if (agents.length > 0 && activeAgentId) {
      list = list.filter((s) => !s.agentId || s.agentId === activeAgentId);
    }
    if (!q) return sortSessionsByActivity(list);
    return sortSessionsByActivity(list.filter((s) => s.title.toLowerCase().includes(q)));
  }, [sessions, sessionQuery, agents.length, activeAgentId]);

  const needsRecentTimeTick = useMemo(() => {
    const now = Date.now();
    return displaySessions.some((s) => {
      const n = Number(s.lastMessageAt?.trim() || s.updatedAt);
      return Number.isFinite(n) && now - n < 120_000;
    });
  }, [displaySessions]);

  useEffect(() => {
    if (!needsRecentTimeTick) return;
    let timer: number | undefined;
    const tick = () => setTimeTick((n) => n + 1);
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(tick, 45_000);
    };
    const stop = () => {
      if (timer == null) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [needsRecentTimeTick]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const el = sessionsListRef.current;
      if (!el) return;
      const rows = el.querySelectorAll<HTMLElement>(".session-row");
      if (rows.length === 0) return;
      if (!sessionsPrevEmptyRef.current) return;
      sessionsPrevEmptyRef.current = false;
      gsap.fromTo(
        rows,
        { autoAlpha: 0, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.35, ease: "power2.out", stagger: 0.04 },
      );
    },
    { scope: sessionsListRef },
  );

  async function onCreateSession() {
    if (sessionBusy) return;
    useSessionStore.getState().enterComposeMode();
    onFocusChat?.();
  }

  async function onSync() {
    if (syncBusy) return;
    setSyncBusy(true);
    const sessionId = active?.id;
    try {
      await syncRemote();
      const updated = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
      const err = useGatewayStore.getState().lastError;
      if (updated?.remoteSessionKey?.trim()) {
        showToast("已绑定办事会话", "success");
      } else {
        showToast(err?.slice(0, 120) || "绑定失败，请稍后重试", "error");
      }
    } finally {
      setSyncBusy(false);
    }
  }

  async function onRefreshSubscription() {
    if (!active || refreshBusy) return;
    setRefreshBusy(true);
    try {
      await refreshSessionSubscription(active.id);
    } catch {
      /* toast 已在 store 内 */
    } finally {
      setRefreshBusy(false);
    }
  }

  async function commitRename(id: string) {
    const next = editDraft.trim();
    setEditingId(null);
    if (!next) return;
    const cur = sessions.find((x) => x.id === id);
    if (cur && next !== cur.title) {
      try {
        await renameSession(id, next);
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      }
    }
  }

  function renderSessionRow(s: typeof displaySessions[number]) {
    const isOn = s.id === activeId;
    void timeTick;
    const timeLabel = formatSessionSidebarTime(
      s.lastMessageAt?.trim() || s.updatedAt,
    );
    const isDeleting = s.id === deletingId;
    return (
      <div
        key={s.id}
        ref={(el) => {
          if (el) rowRefs.current.set(s.id, el);
          else rowRefs.current.delete(s.id);
        }}
        className={["group/row relative", isDeleting ? "opacity-30 pointer-events-none" : ""].join(" ")}
        onContextMenu={(e) => {
          e.preventDefault();
          setDeleteTarget({ id: s.id, title: s.title });
        }}
      >
        {editingId === s.id ? (
          <input
            ref={editInputRef}
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onBlur={() => void commitRename(s.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void commitRename(s.id);
              }
              if (e.key === "Escape") {
                setEditingId(null);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="yt-transition w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--brand-color)_20%,transparent)]"
            maxLength={200}
            aria-label="编辑会话名"
          />
        ) : (
          <div
            className={[
              "yt-transition session-row relative flex min-h-[40px] min-w-0 items-center overflow-hidden rounded-[var(--radius-lg)] px-3 py-2",
              isOn ? "session-row--active" : "",
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => {
                selectSession(s.id);
                onFocusChat?.();
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingId(s.id);
                setEditDraft(s.title);
              }}
              title="单击选中 · 双击重命名"
              aria-current={isOn ? true : undefined}
              className="yt-transition min-w-0 flex-1 text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={[
                    "line-clamp-1 text-sm min-w-0 flex-1",
                    isOn
                      ? "font-semibold text-[var(--text-primary)]"
                      : "font-medium text-[var(--text-secondary)] group-hover/row:text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  {s.title}
                </div>
              </div>
              <div className="mt-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                {timeLabel}
              </div>
            </button>

            {/* Hover actions */}
            <div className="shrink-0 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100">
              <button
                type="button"
                title="重命名"
                aria-label={`重命名会话 ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(s.id);
                  setEditDraft(s.title);
                }}
                className="yt-transition rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <IconPencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="删除"
                aria-label={`删除会话 ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget({ id: s.id, title: s.title });
                }}
                className="yt-transition rounded-md p-1.5 text-[var(--color-error)] hover:bg-[color-mix(in_oklab,var(--color-error)_10%,transparent)]"
              >
                <IconTrash className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-1">
      <div className="shrink-0 px-5 pb-5 pt-0">
        <button
          type="button"
          onClick={() => void onCreateSession()}
          disabled={sessionBusy}
          aria-busy={sessionBusy}
          className="yt-btn-sidebar-primary mb-4"
        >
          <IconPlus className="h-4 w-4" />
          新对话
        </button>

        <label className="sidebar-search">
          <IconSearch className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <input
            type="search"
            value={sessionQuery}
            onChange={(e) => setSessionQuery(e.target.value)}
            placeholder="搜索会话…"
            aria-label="搜索会话"
          />
        </label>

        {active && !active.remoteSessionKey && connState === "connected" && (
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={syncBusy}
            aria-busy={syncBusy}
            className="yt-transition w-full rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_30%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--bg-elevated))] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:border-[color-mix(in_oklab,var(--color-warn)_45%,var(--border-subtle))] disabled:opacity-50"
            title="为本会话建立与本机服务的办事绑定，以便执行工具与推送回复"
          >
            {syncBusy ? "绑定中…" : "绑定办事会话"}
          </button>
        )}
        {showRefreshGatewaySub && (
          <button
            type="button"
            onClick={() => void onRefreshSubscription()}
            disabled={refreshBusy || subscribingSessionId === active?.id}
            className="yt-transition w-full rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_30%,var(--border-subtle))] bg-[color-mix(in_oklab,var(--color-warn)_5%,var(--bg-elevated))] px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:border-[color-mix(in_oklab,var(--color-warn)_45%,var(--border-subtle))] disabled:opacity-50"
            title="实时推送未就绪时，可点此重新订阅以恢复即时回复"
          >
            {refreshBusy || subscribingSessionId === active?.id ? "刷新中…" : "刷新会话订阅"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-5 py-2">
        <div ref={sessionsListRef} className="session-list-scroll h-full min-h-0 space-y-0.5 overflow-y-auto">
          {displaySessions.map((s) => renderSessionRow(s))}

          {displaySessions.length === 0 && sessionQuery.trim() && (
            <p className="px-1 py-6 text-center text-xs text-[var(--text-muted)]">
              无匹配「{sessionQuery.trim()}」
            </p>
          )}
          {sessionsLoading && displaySessions.length === 0 && !sessionQuery.trim() && (
            <div className="flex flex-col gap-1.5 px-1 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2"
                  style={{ animation: "skeleton-pulse 2s ease-in-out infinite", opacity: 0.4 }}
                >
                  <div className="h-7 w-7 shrink-0 rounded-full bg-[var(--bg-hover)]" />
                  <div className="h-3 flex-1 rounded bg-[var(--bg-hover)]" />
                </div>
              ))}
            </div>
          )}
          {displaySessions.length === 0 && !sessionQuery.trim() && !sessionsLoading && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16">
              <svg className="h-8 w-8 text-[var(--text-muted)] opacity-40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.812 9.812 0 0 1-2.59-.337L5.25 21l1.455-4.265A9.113 9.113 0 0 1 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
              <p className="text-xs text-[var(--text-muted)]">暂无会话</p>
              <p className="text-[10px] leading-relaxed text-[var(--text-muted)] opacity-50 text-center">
                选择一个 Agent 或新建对话开始吧
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除此会话？"
        titleId="yuntu-del-session-title"
        variant="danger"
        confirmLabel="删除"
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const { id } = deleteTarget;
          setDeleteTarget(null);
          /* 退场动画 */
          const rowEl = rowRefs.current.get(id);
          if (rowEl && !prefersReducedMotion()) {
            setDeletingId(id);
            await new Promise<void>((resolve) => {
              gsap.to(rowEl, {
                autoAlpha: 0,
                x: -20,
                height: 0,
                marginBottom: 0,
                paddingTop: 0,
                paddingBottom: 0,
                duration: 0.28,
                ease: "power2.in",
                onComplete: resolve,
              });
            });
          }
          setDeletingId(null);
          try {
            await deleteSession(id);
            showToast("已删除会话", "success");
          } catch (e) {
            if (rowEl) gsapReveal(rowEl, "height,margin,padding,x");
            showToast(e instanceof Error ? e.message : String(e), "error");
          }
        }}
      >
        {deleteTarget ? (
          <>
            要删除「<span className="font-medium [color:var(--text-title)]">{deleteTarget.title}</span>」吗？本地聊天
            记录会一并删除，且无法恢复。
          </>
        ) : null}
      </ConfirmDialog>

      {agentReassignId !== null && agents.length > 1 && (
        <ConfirmDialog
          open={true}
          title="关联到 Agent"
          titleId="yuntu-assign-agent-title"
          variant="default"
          confirmLabel=""
          hideConfirm
          onClose={() => setAgentReassignId(null)}
          onConfirm={async () => {}}
        >
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-secondary)]">选择将此会话关联到的 Agent：</p>
            {agents.map((a) => {
              const cur = displaySessions.find((x) => x.id === agentReassignId);
              const isCurrent = cur?.agentId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={async () => {
                    const sid = agentReassignId;
                    setAgentReassignId(null);
                    try {
                      await setSessionAgent(sid, isCurrent ? null : a.id);
                      showToast(
                        isCurrent ? "已取消关联" : `已关联到「${a.name}」`,
                        "success",
                      );
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : String(e), "error");
                    }
                  }}
                  className={[
                    "yt-transition flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-left",
                    isCurrent
                      ? "bg-[var(--brand-surface-select)] font-medium text-[var(--brand-color)]"
                      : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]",
                  ].join(" ")}
                >
                  <AgentAvatar agentId={a.id} agentName={a.name} size={22} />
                  <span className="text-sm">{a.name}</span>
                  {isCurrent && (
                    <span className="ml-auto text-xs text-[var(--text-muted)]">(当前 · 点此取消)</span>
                  )}
                </button>
              );
            })}
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
});
