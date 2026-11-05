import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  collectMeetingSpeakers,
  createMeetingSession,
  deleteMeetingSession,
  exportMeetingDocx,
  formatMeetingElapsed,
  getMeetingLiveState,
  importMeetingAudio,
  listMeetingSessions,
  loadOlderMeetingSegments,
  meetingStatusLabel,
  pushMeetingSegment,
  speakerDisplayLabel,
  SPEAKER_COLORS,
  startMeetingRecording,
  stopMeetingRecording,
  transcribeMeetingAudio,
  triggerMeetingDigest,
  updateMeetingSegment,
  updateMeetingSession,
  type MeetingDigestEvent,
  type MeetingLiveState,
  type MeetingSessionItem,
} from "../../lib/meeting/meeting-bridge";
import { buildMeetingChatText, buildMeetingContextCard } from "../../lib/meeting/meeting-chat";
import { collectMeetingActionItems, pushMeetingTodosToTaskPanel } from "../../lib/meeting/meeting-tasks";
import { startMeetingCapture, type MeetingCaptureSession } from "../../lib/meeting/meeting-live";
import { chatOpenFile } from "../../lib/chat/chat-files-bridge";
import { revealPathInOs } from "../../lib/openclaw/os-open";
import { useUiStore } from "../../stores/uiStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";

function IconMic({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" />
    </svg>
  );
}

function speakerStyle(label: string): string {
  return SPEAKER_COLORS[label] ?? "var(--text-secondary)";
}

type ConfirmKind = "delete" | "restart" | null;

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 6h18" strokeLinecap="round" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  );
}

const SPEAKER_KEYS = ["A", "B", "C"] as const;

export function MeetingPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const queueChatContext = useUiStore((s) => s.queueChatContext);
  const requestNavToComposeChat = useUiStore((s) => s.requestNavToComposeChat);

  const [sessions, setSessions] = useState<MeetingSessionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [live, setLive] = useState<MeetingLiveState | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [digestPending, setDigestPending] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>({ A: "", B: "", C: "" });
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [segmentDraft, setSegmentDraft] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [paused, setPaused] = useState(false);

  const captureRef = useRef<MeetingCaptureSession | null>(null);
  const recordingSessionIdRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [tickMs, setTickMs] = useState(0);

  const refreshList = useCallback(async () => {
    const list = await listMeetingSessions();
    setSessions(list);
    if (!activeId && list.length > 0) {
      const first = list[0];
      if (first) setActiveId(first.id);
    }
  }, [activeId]);

  const refreshLive = useCallback(async (sessionId: string) => {
    const state = await getMeetingLiveState(sessionId);
    setLive(state);
    setSpeakerDrafts({
      A: state.session.speakerAliases.A ?? "",
      B: state.session.speakerAliases.B ?? "",
      C: state.session.speakerAliases.C ?? "",
    });
    if (state.recording) {
      setTickMs(state.elapsedMs);
      recordingSessionIdRef.current = sessionId;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshList();
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "加载会议列表失败", "error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast, refreshList]);

  useEffect(() => {
    if (!activeId) {
      setLive(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await refreshLive(activeId);
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "加载会议失败", "error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, showToast, refreshLive]);

  useEffect(() => {
    const unlistenDigest = listen<MeetingDigestEvent>("meeting-digest-update", (ev) => {
      if (!activeId || ev.payload.sessionId !== activeId) return;
      setDigestPending(false);
      setLive((prev) => {
        if (!prev) return prev;
        const exists = prev.digests.some((d) => d.id === ev.payload.digest.id);
        if (exists) return prev;
        return {
          ...prev,
          digests: [...prev.digests, ev.payload.digest],
          session: { ...prev.session, digestCount: prev.session.digestCount + 1 },
        };
      });
      showToast(`第 ${ev.payload.digest.periodIndex + 1} 阶段纪要已生成`, "info");
    });
    const unlistenPending = listen<{ sessionId: string }>("meeting-digest-pending", (ev) => {
      if (activeId && ev.payload.sessionId === activeId) {
        setDigestPending(true);
      }
    });
    return () => {
      unlistenDigest.then((fn) => fn());
      unlistenPending.then((fn) => fn());
    };
  }, [activeId, showToast]);

  useEffect(() => {
    if (!live?.recording || paused) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    const base = live.elapsedMs;
    const started = Date.now();
    tickRef.current = setInterval(() => {
      setTickMs(base + Date.now() - started);
    }, 500);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [live?.recording, live?.elapsedMs, paused]);

  useEffect(() => {
    if (!autoScrollRef.current || !live?.recording) return;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [live?.segments.length, live?.recording]);

  useEffect(() => {
    return () => {
      void captureRef.current?.stop();
      captureRef.current = null;
      recordingSessionIdRef.current = null;
    };
  }, []);

  const beginRecording = async (sessionId: string) => {
    const captureSessionId = sessionId;
    let backendStarted = false;
    try {
      const state = await startMeetingRecording(captureSessionId);
      backendStarted = true;
      setLive(state);
      setTickMs(0);
      setPaused(false);
      recordingSessionIdRef.current = captureSessionId;

      const capture = await startMeetingCapture(captureSessionId, {
        onSegment: async (seg) => {
          try {
            const item = await pushMeetingSegment({
              sessionId: captureSessionId,
              text: seg.text,
              startMs: seg.startMs,
              endMs: seg.endMs,
              rms: seg.rms,
            });
            setLive((prev) => {
              if (!prev || prev.session.id !== captureSessionId) return prev;
              return {
                ...prev,
                segments: [...prev.segments, item],
                segmentTotal: prev.segmentTotal + 1,
              };
            });
          } catch (err) {
            showToast(err instanceof Error ? err.message : "写入转写失败", "error");
          }
        },
        onError: (message, hint) => {
          showToast(hint ? `${message}\n${hint}` : message, "error");
        },
      });
      captureRef.current = capture;
      showToast("已开始录音与转写（约满 320 字自动整理）", "success");
    } catch (err) {
      if (backendStarted) {
        try {
          await stopMeetingRecording(captureSessionId);
          recordingSessionIdRef.current = null;
          await refreshLive(captureSessionId);
        } catch {
          /* 回滚失败时仍提示原始错误 */
        }
      }
      showToast(err instanceof Error ? err.message : "无法开始录制", "error");
      throw err;
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    try {
      const session = await createMeetingSession(title.trim() || undefined);
      setTitle("");
      await refreshList();
      setActiveId(session.id);
      showToast("已创建会议", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "创建失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    if (!activeId) return;
    const hasContent = (live?.segments.length ?? 0) > 0 || (live?.digests.length ?? 0) > 0;
    if (hasContent) {
      setConfirmKind("restart");
      return;
    }
    setBusy(true);
    try {
      await beginRecording(activeId);
    } catch {
      /* toast 已在 beginRecording */
    } finally {
      setBusy(false);
    }
  };

  const handlePauseToggle = () => {
    const capture = captureRef.current;
    if (!capture) return;
    if (capture.isPaused()) {
      capture.resume();
      setPaused(false);
      showToast("已继续录制", "info");
    } else {
      capture.pause();
      setPaused(true);
      showToast("已暂停录制", "info");
    }
  };

  const handleStop = async () => {
    if (!activeId) return;
    setBusy(true);
    setDigestPending(true);
    try {
      if (captureRef.current) {
        await captureRef.current.stop();
        captureRef.current = null;
      }
      recordingSessionIdRef.current = null;
      setPaused(false);
      const state = await stopMeetingRecording(activeId);
      setLive(state);
      setDigestPending(false);
      await refreshList();
      showToast("录制已结束", "success");
    } catch (err) {
      setDigestPending(false);
      showToast(err instanceof Error ? err.message : "结束录制失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerDigest = async () => {
    if (!activeId) return;
    setBusy(true);
    setDigestPending(true);
    try {
      const state = await triggerMeetingDigest(activeId);
      setLive(state);
      if (state.digests.length === live?.digests.length) {
        showToast("当前内容尚不足以整理（需更多有效发言）", "info");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "整理失败", "error");
    } finally {
      setDigestPending(false);
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    const targetId = deleteTargetId ?? activeId;
    if (!targetId) return;
    setBusy(true);
    try {
      if (captureRef.current && recordingSessionIdRef.current === targetId) {
        await captureRef.current.stop();
        captureRef.current = null;
      }
      if (recordingSessionIdRef.current === targetId) {
        recordingSessionIdRef.current = null;
      }
      await deleteMeetingSession(targetId);
      if (activeId === targetId) {
        setActiveId(null);
        setLive(null);
      }
      await refreshList();
      showToast("会议已删除", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "删除失败", "error");
    } finally {
      setBusy(false);
      setConfirmKind(null);
      setDeleteTargetId(null);
    }
  };

  const requestDeleteSession = (sessionId: string) => {
    if (recordingSessionIdRef.current && recordingSessionIdRef.current !== sessionId) {
      showToast("请先结束当前录制", "error");
      return;
    }
    if (recordingSessionIdRef.current === sessionId) {
      showToast("录制中的会议请先结束录制再删除", "error");
      return;
    }
    setDeleteTargetId(sessionId);
    setConfirmKind("delete");
  };

  const handleExport = async (speaker?: "A" | "B" | "C") => {
    if (!activeId || !live) return;
    setBusy(true);
    try {
      const path = await exportMeetingDocx(activeId, speaker ?? null);
      const label = speaker
        ? speakerDisplayLabel(live.session.speakerAliases, speaker)
        : "会议纪要";
      showToast(`已导出 ${label} Word`, "success");
      try {
        await chatOpenFile(path);
      } catch {
        try {
          await revealPathInOs(path);
        } catch {
          showToast(`文件已保存：${path}`, "info");
        }
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "导出 Word 失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleImportAudio = async () => {
    if (!activeId) return;
    setBusy(true);
    setTranscribing(true);
    try {
      await importMeetingAudio(activeId);
      showToast("音频已导入，正在转写…", "info");
      const state = await transcribeMeetingAudio(activeId);
      setLive(state);
      await refreshList();
      showToast(`转写完成，共 ${state.segmentTotal || state.segments.length} 段${state.digests.length > 0 ? "，已尝试阶段整理" : ""}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "导入失败";
      if (!msg.includes("未选择") && !msg.toLowerCase().includes("cancel")) {
        showToast(msg, "error");
        try {
          await refreshLive(activeId);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
      setTranscribing(false);
    }
  };

  const handleLoadOlder = async () => {
    if (!activeId || !live || live.segments.length === 0) return;
    setLoadingOlder(true);
    autoScrollRef.current = false;
    try {
      const first = live.segments[0];
      if (!first) return;
      const page = await loadOlderMeetingSegments(activeId, first.startMs);
      setLive((prev) => {
        if (!prev) return prev;
        const existingIds = new Set(prev.segments.map((s) => s.id));
        const merged = [
          ...page.segments.filter((s) => !existingIds.has(s.id)),
          ...prev.segments,
        ];
        return {
          ...prev,
          segments: merged,
          hasMoreSegments: page.hasMore,
          segmentTotal: page.total,
        };
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : "加载更早内容失败", "error");
    } finally {
      setLoadingOlder(false);
    }
  };

  const saveTitle = async () => {
    if (!activeId || !live) return;
    const next = titleDraft.trim();
    if (!next || next === live.session.title) {
      setEditingTitle(false);
      return;
    }
    setBusy(true);
    try {
      const session = await updateMeetingSession({ sessionId: activeId, title: next });
      setLive((prev) => (prev ? { ...prev, session: { ...prev.session, title: session.title } } : prev));
      await refreshList();
      setEditingTitle(false);
      showToast("标题已更新", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新标题失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveSpeakerAlias = async (speaker: "A" | "B" | "C") => {
    if (!activeId || !live) return;
    const next = speakerDrafts[speaker]?.trim() ?? "";
    const prev = live.session.speakerAliases[speaker]?.trim() ?? "";
    if (next === prev) return;
    setBusy(true);
    try {
      const aliases = { ...live.session.speakerAliases, [speaker]: next };
      const session = await updateMeetingSession({ sessionId: activeId, speakerAliases: aliases });
      setLive((p) => (p ? { ...p, session: { ...p.session, speakerAliases: session.speakerAliases } } : p));
      showToast(`发言人 ${speaker} 已更新`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新发言人失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveSegmentEdit = async () => {
    if (!activeId || !editingSegmentId) return;
    const text = segmentDraft.trim();
    if (!text) {
      showToast("段落内容不能为空", "error");
      return;
    }
    setBusy(true);
    try {
      const updated = await updateMeetingSegment({
        sessionId: activeId,
        segmentId: editingSegmentId,
        text,
      });
      setLive((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          segments: prev.segments.map((s) => (s.id === updated.id ? updated : s)),
        };
      });
      setEditingSegmentId(null);
      setSegmentDraft("");
      showToast("段落已更新", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "更新段落失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePushTodos = async () => {
    if (!live) return;
    const preview = collectMeetingActionItems(live);
    if (preview.length === 0) {
      showToast("暂无待办项，请先完成阶段整理或点击「立即整理」", "info");
      return;
    }
    setBusy(true);
    try {
      const n = await pushMeetingTodosToTaskPanel(live);
      showToast(`已将 ${n} 条待办写入任务侧栏`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "写入待办失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleSendToChat = () => {
    if (!live) return;
    if (live.segments.length === 0 && live.digests.length === 0) {
      showToast("暂无会议内容可发送", "error");
      return;
    }
    queueChatContext(buildMeetingChatText(live), [buildMeetingContextCard(live)]);
    requestNavToComposeChat();
    showToast("已将会议卡片填入对话，请确认后发送", "success");
  };

  const actionItemCount = live ? collectMeetingActionItems(live).length : 0;
  const recording = live?.recording ?? false;
  const recordingSessionId = recordingSessionIdRef.current;
  const speakers = collectMeetingSpeakers(live?.segments ?? []);
  const aliases = live?.session.speakerAliases ?? {};

  return (
    <div className="flex min-h-0 h-full flex-col gap-4 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-56">
        <div className="text-sm font-semibold text-[var(--text-primary)]">会议列表</div>
        {recordingSessionId && (
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-color)]/30 bg-[var(--brand-tint-8)] px-3 py-2 text-xs text-[var(--brand-color)]">
            正在录制：{sessions.find((s) => s.id === recordingSessionId)?.title ?? "当前会议"}
            {paused && "（已暂停）"}
          </div>
        )}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新会议标题（可选）"
          disabled={Boolean(recordingSessionId)}
          className="w-full rounded-[var(--radius-md)] border border-[var(--separator)] bg-[var(--surface-glass)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || Boolean(recordingSessionId)}
          onClick={() => void handleCreate()}
          className="yt-btn-primary rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          新建会议
        </button>
        <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-md)] border border-[var(--separator)] bg-[var(--surface-glass)]">
          {loading ? (
            <div className="p-3 text-xs text-[var(--text-tertiary)]">加载中…</div>
          ) : sessions.length === 0 ? (
            <div className="p-3 text-xs text-[var(--text-tertiary)]">暂无会议，先新建一个</div>
          ) : (
            sessions.map((s) => {
              const isRecordingThis = recordingSessionId === s.id;
              const locked = Boolean(recordingSessionId && !isRecordingThis);
              const selected = activeId === s.id;
              return (
                <div
                  key={s.id}
                  className={[
                    "group flex items-stretch border-b border-[var(--separator)]/40",
                    selected ? "bg-[var(--brand-tint-8)]" : "hover:bg-[var(--surface-glass)]",
                    locked ? "opacity-40" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => setActiveId(s.id)}
                    className={[
                      "min-w-0 flex-1 px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                      selected ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {isRecordingThis && (
                        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--brand-color)]" aria-hidden />
                      )}
                      <span className="truncate">{s.title}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">
                      {meetingStatusLabel(s.status)} · {s.digestCount} 阶段
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={busy || isRecordingThis}
                    onClick={(e) => {
                      e.stopPropagation();
                      requestDeleteSession(s.id);
                    }}
                    className={[
                      "yt-press shrink-0 px-2 text-[var(--text-tertiary)] transition-opacity hover:text-rose-500 disabled:opacity-30",
                      "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      "[@media(hover:none)]:opacity-55",
                    ].join(" ")}
                    title="删除会议"
                    aria-label={`删除 ${s.title}`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col gap-3">
        {!activeId || !live ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--separator)] text-sm text-[var(--text-tertiary)]">
            选择或新建会议后开始录制
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--separator)] bg-[var(--surface-glass)] px-4 py-3">
              <div className="min-w-0 flex-1">
                {editingTitle && !recording ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveTitle();
                        if (e.key === "Escape") setEditingTitle(false);
                      }}
                      className="flex-1 rounded-[var(--radius-md)] border border-[var(--separator)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)]"
                      autoFocus
                    />
                    <button type="button" disabled={busy} onClick={() => void saveTitle()} className="text-xs text-[var(--brand-color)]">
                      保存
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={recording}
                    onClick={() => {
                      setTitleDraft(live.session.title);
                      setEditingTitle(true);
                    }}
                    className="text-left text-base font-semibold text-[var(--text-primary)] disabled:cursor-default"
                    title={recording ? undefined : "点击编辑标题"}
                  >
                    {live.session.title}
                  </button>
                )}
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  说话人 A/B/C（实验性）· 约满 320 字自动整理 · 导出 Word
                  {live.segmentTotal > live.segments.length && (
                    <span className="ml-1 text-[var(--text-tertiary)]">
                      · 显示最近 {live.segments.length}/{live.segmentTotal} 段
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 font-mono text-lg tabular-nums text-[var(--text-primary)]">
                {recording && !paused && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--brand-color)]" aria-hidden />
                )}
                {recording && paused && (
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                )}
                {formatMeetingElapsed(recording && !paused ? tickMs : live.elapsedMs)}
              </div>
              {!recording ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStart()}
                    className="yt-btn-primary flex items-center gap-2 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium"
                  >
                    <IconMic className="h-4 w-4" />
                    开始录制
                  </button>
                  <button
                    type="button"
                    disabled={busy || transcribing}
                    onClick={() => void handleImportAudio()}
                    className="yt-btn-secondary text-sm"
                  >
                    {transcribing ? "转写中…" : "上传并转写"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handlePauseToggle}
                    className="yt-btn-secondary text-sm"
                  >
                    {paused ? "继续" : "暂停"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleStop()}
                    className="yt-btn-secondary text-sm"
                  >
                    结束录制
                  </button>
                </>
              )}
              {recording && (
                <button
                  type="button"
                  disabled={busy || digestPending || live.segments.length === 0}
                  onClick={() => void handleTriggerDigest()}
                  className="yt-btn-secondary text-sm"
                >
                  {digestPending ? "整理中…" : "立即整理"}
                </button>
              )}
              <button
                type="button"
                disabled={busy || recording || (!live.segments.length && !live.digests.length)}
                onClick={() => void handleExport()}
                className="yt-btn-secondary text-sm"
              >
                导出 Word
              </button>
              {speakers.map((sp) => (
                <button
                  key={sp}
                  type="button"
                  disabled={busy || recording}
                  onClick={() => void handleExport(sp)}
                  className="yt-btn-secondary px-2.5 py-2 text-sm font-medium"
                  style={{ color: speakerStyle(sp) }}
                  title={`仅导出 ${speakerDisplayLabel(aliases, sp)}`}
                >
                  导出{speakerDisplayLabel(aliases, sp)}
                </button>
              ))}
              <button
                type="button"
                disabled={busy || recording || actionItemCount === 0}
                onClick={() => void handlePushTodos()}
                className="yt-btn-secondary text-sm"
                title={actionItemCount > 0 ? `${actionItemCount} 条待办` : undefined}
              >
                待办入任务{actionItemCount > 0 ? ` (${actionItemCount})` : ""}
              </button>
              <button
                type="button"
                disabled={busy || recording || (!live.segments.length && !live.digests.length)}
                onClick={handleSendToChat}
                className="yt-btn-secondary text-sm"
              >
                发给 Agent
              </button>
              <button
                type="button"
                disabled={busy || recording}
                onClick={() => activeId && requestDeleteSession(activeId)}
                className="yt-btn-ghost text-sm text-[var(--text-tertiary)] hover:text-rose-500"
              >
                删除
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--separator)]/50 bg-[var(--surface-glass)] px-3 py-2">
              <span className="text-xs text-[var(--text-tertiary)]">发言人别名</span>
              {SPEAKER_KEYS.map((sp) => (
                <div key={sp} className="flex items-center gap-1">
                  <span className="text-xs font-semibold" style={{ color: speakerStyle(sp) }}>
                    {sp}
                  </span>
                  <input
                    type="text"
                    value={speakerDrafts[sp] ?? ""}
                    onChange={(e) => setSpeakerDrafts((d) => ({ ...d, [sp]: e.target.value }))}
                    onBlur={() => void saveSpeakerAlias(sp)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder={`发言人 ${sp}`}
                    disabled={busy}
                    className="w-24 rounded border border-[var(--separator)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)] disabled:opacity-50"
                  />
                </div>
              ))}
            </div>

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
              <section className="flex min-h-0 flex-col rounded-[var(--radius-lg)] border border-[var(--separator)] bg-[var(--surface-glass)]">
                <div className="shrink-0 border-b border-[var(--separator)]/40 px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                  阶段整理（约满 320 字）
                  {digestPending && (
                    <span className="ml-2 text-[var(--brand-color)]">整理中…</span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3 space-y-3">
                  {live.digests.length === 0 ? (
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {digestPending
                        ? "正在整理本阶段内容…"
                        : recording
                          ? "有足够有效发言后将自动生成阶段纪要（约 320 字 / 最长约 90 秒保底）…"
                          : "暂无阶段纪要"}
                    </div>
                  ) : (
                    live.digests.map((d) => (
                      <article
                        key={d.id}
                        className="rounded-[var(--radius-md)] border border-[var(--separator)]/50 bg-[var(--bg-elevated)] p-3"
                      >
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                          阶段 {d.periodIndex + 1} · {formatMeetingElapsed(d.endMs - d.startMs)}
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--text-primary)]">{d.summary}</p>
                        {d.decisions.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                            {d.decisions.map((item) => (
                              <li key={item}>决议：{item}</li>
                            ))}
                          </ul>
                        )}
                        {d.actionItems.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-[var(--brand-color)]">
                            {d.actionItems.map((item) => (
                              <li key={item}>待办：{item}</li>
                            ))}
                          </ul>
                        )}
                        {d.openQuestions.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-amber-600 dark:text-amber-400">
                            {d.openQuestions.map((item) => (
                              <li key={item}>未决：{item}</li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </section>

              <section className="flex min-h-0 flex-col rounded-[var(--radius-lg)] border border-[var(--separator)] bg-[var(--surface-glass)]">
                <div className="shrink-0 border-b border-[var(--separator)]/40 px-4 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                  实时转写（A / B / C）
                </div>
                <div
                  className="min-h-0 flex-1 overflow-auto p-3 space-y-2"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                  }}
                >
                  {live.hasMoreSegments && (
                    <button
                      type="button"
                      disabled={loadingOlder}
                      onClick={() => void handleLoadOlder()}
                      className="mb-2 w-full rounded-[var(--radius-md)] border border-dashed border-[var(--separator)] py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50"
                    >
                      {loadingOlder ? "加载中…" : "加载更早的转写"}
                    </button>
                  )}
                  {live.segments.length === 0 ? (
                    <div className="text-xs text-[var(--text-tertiary)]">
                      {recording
                        ? paused
                          ? "录制已暂停，点击「继续」恢复听写"
                          : "正在听写…请对着麦克风说话"
                        : live.session.audioPath
                          ? "已保存录音，可点击「上传并转写」或开始实时录制"
                          : "暂无转写内容"}
                    </div>
                  ) : (
                    live.segments.map((seg) => (
                      <div key={seg.id} className="group flex gap-2 text-sm leading-relaxed">
                        <span
                          className="shrink-0 font-semibold"
                          style={{ color: speakerStyle(seg.speaker) }}
                          title={`发言人 ${seg.speaker}`}
                        >
                          {speakerDisplayLabel(aliases, seg.speaker)}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
                          {formatMeetingElapsed(seg.startMs)}
                        </span>
                        {editingSegmentId === seg.id ? (
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <textarea
                              value={segmentDraft}
                              onChange={(e) => setSegmentDraft(e.target.value)}
                              rows={2}
                              className="w-full rounded border border-[var(--separator)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand-color)]"
                              autoFocus
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void saveSegmentEdit()}
                                className="text-xs text-[var(--brand-color)]"
                              >
                                保存
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSegmentId(null);
                                  setSegmentDraft("");
                                }}
                                className="text-xs text-[var(--text-tertiary)]"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={recording || busy}
                            onClick={() => {
                              setEditingSegmentId(seg.id);
                              setSegmentDraft(seg.text);
                            }}
                            className="min-w-0 flex-1 text-left text-[var(--text-primary)] disabled:cursor-default"
                            title={recording ? undefined : "点击编辑"}
                          >
                            {seg.text}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </section>
            </div>
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmKind === "delete"}
        title="删除会议"
        titleId="meeting-delete-title"
        variant="danger"
        confirmLabel="删除"
        disabled={busy}
        confirmLoading={busy}
        onClose={() => {
          setConfirmKind(null);
          setDeleteTargetId(null);
        }}
        onConfirm={() => void handleDelete()}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          将永久删除此会议的全部转写、阶段整理与录音文件，且无法恢复。
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmKind === "restart"}
        title="重新开始录制"
        titleId="meeting-restart-title"
        variant="danger"
        confirmLabel="清空并重新录制"
        disabled={busy}
        confirmLoading={busy}
        onClose={() => setConfirmKind(null)}
        onConfirm={async () => {
          if (!activeId) return;
          setBusy(true);
          try {
            await beginRecording(activeId);
            setConfirmKind(null);
          } catch {
            /* toast 已提示 */
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          重新录制将清空当前会议的全部转写与阶段整理，此操作不可撤销。
        </p>
      </ConfirmDialog>
    </div>
  );
}
