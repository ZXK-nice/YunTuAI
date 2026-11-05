import { create } from "zustand";
import { markGatewayEverConnected } from "../lib/first-run-gateway";
import { sanitizeUserFacingCopy, SERVICE_PATH_LABELS } from "../lib/product-copy";
import { buildGatewayWsUrl } from "../lib/openclaw/config";
import { TRUNCATE_ERROR, TRUNCATE_TOAST, TRUNCATE_TOAST_SHORT } from "../lib/constants";
import { getGatewayClient } from "../lib/openclaw/gateway-runtime";
import { applyGatewayChatEvent } from "../lib/openclaw/apply-chat-final-event";
import {
  clearSessionSubscriptionTracking,
  ensureSessionsIndexSubscribed,
  ensureSessionsMessagesSubscribed,
} from "../lib/openclaw/session-subscribe";
import { handleGatewaySessionsChanged } from "../lib/openclaw/sessions-changed-sync";
import { resetNativeSendCapabilityCache } from "../lib/openclaw/session-native-send";
import {
  applyGatewayToasts,
  runAbnormalCloseStrategy,
  runConnectFailureStrategy,
  runGatewayStallNoResponseStrategy,
} from "../lib/openclaw/gateway-recovery";
import { probeGatewayCapabilities, clearCapabilitiesCache } from "../lib/openclaw/gateway-capabilities";
import {
  cliGatewaySupervisorEnsure,
  cliGatewaySupervisorReclaim,
  cliGatewaySupervisorRestart,
  cliOpenClawExclusiveReport,
  cliSuppressExternalOpenClaw,
  getGatewayConnectCredentialsWithRetry,
} from "../lib/openclaw/cli-bridge";
import { prepareGatewayForConnect } from "../lib/openclaw/gateway-connect-preflight";
import {
  endGatewayRecovery,
  tryBeginGatewayRecoveryOrSchedule,
} from "../lib/openclaw/gateway-recovery-lock";
import { repairGatewayConnection } from "../lib/openclaw/repair-gateway-connection";
import { isTauriRuntime } from "../lib/tauri-env";
import {
  setLastAnyWsEventMs,
  getLastAnyWsEventMs,
  getStepIngestGraceUntil,
  setStepIngestGraceUntil,
} from "../lib/openclaw/gateway-shared-state";
import { isGatewayNoopEvent } from "../lib/openclaw/gateway-noop-events";
import { useUiStore } from "./uiStore";
import { useAgentStore } from "./agentStore";
import { useSessionStore } from "./sessionStore";
import { useExecApprovalStore } from "./execApprovalStore";
import { getItem, setItem, setFlag } from "../lib/safeStorage";
import { cleanupGatewaySessionState } from "../lib/gateway-disconnect-cleanup";
import { latencyToQuality } from "../lib/connection-quality";
import {
  connectFailureReconnectDelayMs,
  isGatewayAuthError,
  isGatewayRateLimitedError,
  isSupervisorGatewayOperational,
  sleepMs,
} from "../lib/openclaw/connection-resilience";
import { withTimeout } from "../lib/async-utils";
import {
  invalidateConnectPipeline,
  isConnectOrchestrationInFlight,
  isConnectPipelineUiSuppressed,
} from "../lib/connect-with-feedback";
import {
  CONNECTION_MONITOR_INTERVAL_MS,
  CONNECTION_MONITOR_START_DELAY_MS,
  CONNECT_DEFERRED_SYNC_MS,
  CONNECT_POST_HANDSHAKE_DEFER_MS,
  CONNECT_POST_HANDSHAKE_PROBE_MS,
  CONNECT_POST_HANDSHAKE_RETRIES,
  DEFAULT_PORT,
  EXCLUSIVE_REPORT_MIN_INTERVAL_MS,
  GATEWAY_CONNECT_MAX_MS,
  HEALTH_RPC_MS,
  LS_AUTO_REMEDIATE,
  LS_STALL_WATCHDOG,
  LS_TOKEN,
  LS_URL,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_SOON_FAST_ATTEMPTS,
  RECONNECT_SOON_MS,
  STALL_FAILS_BEFORE_RECOVERY,
  STALL_WS_ACTIVITY_GRACE_MS,
  backoffMs,
  loadLocalPrefs,
  persistLocalPrefs,
  purgeLegacyGatewayTokenOverride,
  readAutoRemediateDefaultTrue,
  readStallWatchdogDefaultTrue,
  rpcWithTimeout,
} from "./gateway-store-constants";
import {
  awaitGatewayConnectSettled,
  gatewayConnectFlight,
} from "./gateway-store-connect-flight";
import { clearStepIngestQueue, queueStepIngest, shouldIngestSteps } from "./gateway-store-step-ingest";
import type { GatewayConnState, GatewayStore } from "./gateway-store-types";

export { CONNECTION_MONITOR_INTERVAL_MS };
export { awaitGatewayConnectSettled };
export type { GatewayConnState, GatewayStore };
export {
  gatewayCreateRemoteSession,
  gatewayListSessions,
  gatewaySessionLabelForCreate,
} from "./gateway-store-remote-sessions";

// Re-export shared state for legacy consumers (sessionStore before the circular dep fix)
export { getLastAnyWsEventMs } from "../lib/openclaw/gateway-shared-state";

/** 提取网关清理逻辑（不含 stopConnectionMonitor — 它依赖 store 闭包变量）：
 * 清理会话/缓存/去重状态，断开 WebSocket。 */
function performGatewayDisconnect(opts?: { stopActiveTask?: boolean }) {
  const stopActiveTask = opts?.stopActiveTask === true;
  if (useSessionStore.getState().isSending && !stopActiveTask) {
    useSessionStore.getState().releaseActiveSendWaitOnly();
  }

  setLastAnyWsEventMs(0);
  clearStepIngestQueue();
  setStepIngestGraceUntil(0);
  cleanupGatewaySessionState({ stopActiveTask });
  useSessionStore.getState().markSubscriptionsDisconnected();
  clearSessionSubscriptionTracking();
  resetNativeSendCapabilityCache();
  clearCapabilitiesCache();
  useExecApprovalStore.setState({ queue: [], error: null, busy: false, snoozedUntil: {} });
  getGatewayClient().disconnect();
}

export const useGatewayStore = create<GatewayStore>((set, get) => {
  let connectionMonitorTimer: ReturnType<typeof setInterval> | null = null;
  let connectionMonitorStartTimer: ReturnType<typeof setTimeout> | null = null;
  let stallStrikes = 0;
  let monitorInFlight = false;
  let connectDeferredSyncTimer: ReturnType<typeof setTimeout> | null = null;

  const clearConnectDeferredSyncTimer = () => {
    if (connectDeferredSyncTimer) {
      clearTimeout(connectDeferredSyncTimer);
      connectDeferredSyncTimer = null;
    }
  };

  const shouldDeferAutoReconnect = () => {
    if (isConnectOrchestrationInFlight()) return true;
    const phase = get().startupPhase;
    return Boolean(phase && !isConnectPipelineUiSuppressed());
  };

  const scheduleReconnectSoon = () => {
    const attempt = get().reconnectAttempt;
    if (attempt < RECONNECT_SOON_FAST_ATTEMPTS) {
      scheduleReconnectAfter(RECONNECT_SOON_MS);
      return;
    }
    scheduleReconnectAfter(backoffMs(attempt));
  };

  const scheduleReconnectAfter = (
    delayMs: number,
    opts?: { rateLimited?: boolean; resetAttempt?: boolean },
  ) => {
    get().cancelReconnect();
    if (!get().autoReconnect) return;
    if (shouldDeferAutoReconnect()) return;
    if (opts?.resetAttempt) {
      set({ reconnectAttempt: 0 });
    }
    const attempt = get().reconnectAttempt;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      set({
        autoReconnect: false,
        connState: "error",
        lastError: `已连续 ${MAX_RECONNECT_ATTEMPTS} 次重连失败，已停止自动重连。请到软件设置 → 本机服务手动连接。`,
      });
      useUiStore.getState().showToast(
        `连续 ${MAX_RECONNECT_ATTEMPTS} 次重连失败，已停止自动重连。请排查原因后手动「连接服务」。`,
        "error",
      );
      return;
    }
    const dueAt = Date.now() + delayMs;
    const timer = setTimeout(() => {
      set({ reconnectTimer: null, reconnectDueAt: null, reconnectDelayMs: 0 });
      const gs = get();
      const skipPrepare = isSupervisorGatewayOperational(
        gs.exclusiveReport?.supervisor ?? null,
      );
      void gs
        .connect({ skipPrepare })
        .catch((e) => {
          if (shouldDeferAutoReconnect()) return;
          // 中间失败静默退避；仅在即将耗尽次数时提示一次，避免平日刷屏
          const nextAttempt = get().reconnectAttempt;
          if (nextAttempt < MAX_RECONNECT_ATTEMPTS - 1) return;
          const msg = e instanceof Error ? e.message : String(e);
          useUiStore.getState().showToast(`自动重连失败：${msg.slice(0, TRUNCATE_TOAST)}`, "error");
        });
    }, delayMs);
    set({
      reconnectTimer: timer,
      reconnectAttempt: attempt + 1,
      reconnectDelayMs: delayMs,
      reconnectDueAt: dueAt,
    });
    if (opts?.rateLimited) {
      useUiStore.getState().showToast(
        `网关认证限流，约 ${Math.ceil(delayMs / 1000)} 秒后自动重连…`,
        "info",
      );
    }
  };

  const recordHealthSample = (ms: number) => {
    set({ healthLatencyMs: ms, connectionQuality: latencyToQuality(ms) });
  };

  const stopConnectionMonitor = () => {
    if (connectionMonitorStartTimer) {
      clearTimeout(connectionMonitorStartTimer);
      connectionMonitorStartTimer = null;
    }
    if (connectionMonitorTimer) {
      clearInterval(connectionMonitorTimer);
      connectionMonitorTimer = null;
    }
    stallStrikes = 0;
  };

  const runConnectionMonitorTick = async () => {
    if (monitorInFlight) return;
    if (get().connState !== "connected") {
      stopConnectionMonitor();
      return;
    }
    const c = getGatewayClient();
    if (!c.isHelloOk) return;
    monitorInFlight = true;
    const t0 = performance.now();
    try {
      await c.request("health", {}, { timeoutMs: HEALTH_RPC_MS });
      recordHealthSample(Math.round(performance.now() - t0));
      stallStrikes = 0;
    } catch (e) {
      set({ healthLatencyMs: null, connectionQuality: "poor" });
      if (!get().stallWatchdogEnabled) return;
      // 发送中 / 步骤摄入宽限期 / 近期仍有 WS 活动：不触发自动恢复
      if (useSessionStore.getState().isSending) return;
      if (Date.now() < getStepIngestGraceUntil()) return;
      const lastWs = getLastAnyWsEventMs();
      if (lastWs > 0 && Date.now() - lastWs < STALL_WS_ACTIVITY_GRACE_MS) {
        stallStrikes = 0;
        return;
      }
      const lastMsg = e instanceof Error ? e.message : String(e);
      stallStrikes += 1;
      if (stallStrikes < STALL_FAILS_BEFORE_RECOVERY) {
        // 中间失败只更新质量指示，不弹 Toast（长推理时易误报）
        return;
      }
      stallStrikes = 0;
      if (!tryBeginGatewayRecoveryOrSchedule(() => { void runConnectionMonitorTick(); })) return;
      stopConnectionMonitor();
      const willAutoRecover = get().autoReconnect && !shouldDeferAutoReconnect();
      if (willAutoRecover) {
        gatewayConnectFlight.suppressNextReconnectSuccessToast = true;
      }
      performGatewayDisconnect();
      try {
        const st = get();
        const r = await runGatewayStallNoResponseStrategy({
          wsUrl: st.wsUrl,
          autoRemediate: st.autoRemediateOpenClaw,
          consecutiveFailures: STALL_FAILS_BEFORE_RECOVERY,
          lastFailureMessage: lastMsg,
          monitorIntervalMs: CONNECTION_MONITOR_INTERVAL_MS,
        });
        const autoRecover =
          get().autoReconnect && (r.followUp === "reconnect" || r.followUp === "reconnect_soon");
        if (autoRecover) {
          gatewayConnectFlight.suppressNextReconnectSuccessToast = true;
          set({
            lastError: null,
            gatewayLastIncident: r.incident,
            connState: "connecting",
            serverInfo: null,
            healthLatencyMs: null,
            connectionQuality: "unknown",
          });
        } else {
          set({
            lastError: r.displayError,
            gatewayLastIncident: r.incident,
            connState: "error",
            serverInfo: null,
            healthLatencyMs: null,
            connectionQuality: "unknown",
          });
          applyGatewayToasts(r.toasts, useUiStore.getState().showToast);
        }
        get().cancelReconnect();
        if (r.followUp === "reconnect_soon") {
          scheduleReconnectSoon();
          return;
        }
        if (r.followUp === "reconnect") {
          get().scheduleReconnect();
        }
      } finally {
        endGatewayRecovery();
      }
    } finally {
      monitorInFlight = false;
    }
  };

  const startConnectionMonitor = () => {
    stopConnectionMonitor();
    if (import.meta.env.MODE === "test" || !isTauriRuntime()) return;
    connectionMonitorStartTimer = window.setTimeout(() => {
      connectionMonitorStartTimer = null;
      if (get().connState !== "connected") return;
      void runConnectionMonitorTick();
      connectionMonitorTimer = setInterval(() => {
        void runConnectionMonitorTick();
      }, CONNECTION_MONITOR_INTERVAL_MS);
    }, CONNECTION_MONITOR_START_DELAY_MS);
  };

  /** 握手成功后的统一后置：订阅索引 + 稳定管线 + Agent/能力探测 */
  const runConnectedSideEffects = (myGen: number) => {
    markGatewayEverConnected();
    const wasReconnect =
      gatewayConnectFlight.connStateBeforeConnect === "disconnected" ||
      gatewayConnectFlight.connStateBeforeConnect === "error" ||
      gatewayConnectFlight.connStateBeforeConnect === "connecting";
    if (wasReconnect && !gatewayConnectFlight.suppressNextReconnectSuccessToast) {
      useUiStore.getState().showToast("本机服务已恢复，草稿与未完成任务可继续", "success");
    }
    gatewayConnectFlight.suppressNextReconnectSuccessToast = false;
    gatewayConnectFlight.connStateBeforeConnect = "connected";
    startConnectionMonitor();

    window.setTimeout(() => {
      if (myGen !== gatewayConnectFlight.generation || get().connState !== "connected") return;
      void ensureSessionsIndexSubscribed(getGatewayClient()).catch(() => undefined);
    }, CONNECT_POST_HANDSHAKE_DEFER_MS + 400);

    const runStability = () => {
      if (get().connState !== "connected") return;
      void import("../lib/openclaw/runtime-stability")
        .then((m) => m.runPostConnectStabilityPipeline())
        .then((report) => {
          if (report.activeBackfillAppended > 0) {
            useUiStore.getState().showToast(
              `已同步 ${report.activeBackfillAppended} 条对话记录`,
              "info",
            );
          }
        })
        .catch(() => undefined);
    };

    clearConnectDeferredSyncTimer();

    const scheduleStability = () => {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(
          () => runStability(),
          { timeout: wasReconnect ? 800 : CONNECT_DEFERRED_SYNC_MS + 400 },
        );
      } else {
        connectDeferredSyncTimer = window.setTimeout(() => {
          connectDeferredSyncTimer = null;
          runStability();
        }, wasReconnect ? 400 : CONNECT_DEFERRED_SYNC_MS);
      }
    };
    scheduleStability();

    void useAgentStore
      .getState()
      .loadAgents()
      .then(() => {
        if (myGen !== gatewayConnectFlight.generation) return;
        if (!get().gatewayCapabilities) {
          const count = useAgentStore.getState().agents.length;
          void probeGatewayCapabilities({ skipAgentsList: true, knownAgentCount: count })
            .then((caps) => set({ gatewayCapabilities: caps }))
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
  };

  return {
  wsUrl: "ws://127.0.0.1:18789",
  token: "",
  autoRemediateOpenClaw: readAutoRemediateDefaultTrue(),
  gatewayLastIncident: null,
  exclusiveReport: null,
  exclusiveLoading: false,
  gatewayCapabilities: null,
  stallWatchdogEnabled: readStallWatchdogDefaultTrue(),
  connState: "disconnected",
  lastError: null,
  serverInfo: null,
  reconnectAttempt: 0,
  reconnectDelayMs: 0,
  reconnectDueAt: null,
  autoReconnect: true,
  reconnectTimer: null,
  healthLatencyMs: null,
  connectionQuality: "unknown",
  startupPhase: null,

  setWsUrl: (v) => {
    setItem(LS_URL, v);
    set({ wsUrl: v });
    persistLocalPrefs(v);
  },
  setToken: (v) => {
    const t = v.trim();
    purgeLegacyGatewayTokenOverride();
    set({ token: t });
    persistLocalPrefs(get().wsUrl);
  },
  setAutoReconnect: (v) => set({ autoReconnect: v }),
  setAutoRemediateOpenClaw: (v) => {
    setFlag(LS_AUTO_REMEDIATE, v);
    set({ autoRemediateOpenClaw: v });
  },
  setStallWatchdogEnabled: (v) => {
    setFlag(LS_STALL_WATCHDOG, v);
    set({ stallWatchdogEnabled: v });
  },

  applyExclusiveReport: (report) => {
    gatewayConnectFlight.lastExclusiveFetchAt = Date.now();
    set({ exclusiveReport: report });
  },

  refreshExclusiveReport: async () => {
    if (!isTauriRuntime()) return;
    const now = Date.now();
    if (now - gatewayConnectFlight.lastExclusiveFetchAt < EXCLUSIVE_REPORT_MIN_INTERVAL_MS && get().exclusiveReport) return;
    if (get().exclusiveLoading) return;
    set({ exclusiveLoading: true });
    try {
      const report = await cliOpenClawExclusiveReport();
      if (report) {
        gatewayConnectFlight.lastExclusiveFetchAt = Date.now();
        set({ exclusiveReport: report });
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const gs = get();
      if (gs.connState !== "connecting" && !gs.startupPhase) {
        console.debug("[YunTuAI] exclusive report fetch failed:", raw.slice(0, TRUNCATE_ERROR));
      }
    } finally {
      set({ exclusiveLoading: false });
    }
  },

  reclaimExclusive: async () => {
    if (!isTauriRuntime()) return false;
    try {
      await cliSuppressExternalOpenClaw().catch(() => null);
      const reclaimReport = await cliGatewaySupervisorReclaim();
      if (reclaimReport) set({ exclusiveReport: reclaimReport });
      /* 回收后端口可能仍短暂占用；必须 ensure 拉起监管实例，不能因冲突标记提前返回 */
      const ensured = await cliGatewaySupervisorEnsure();
      const report = await cliOpenClawExclusiveReport();
      if (report) {
        set({
          exclusiveReport: report,
        });
      } else if (ensured) {
        set((s) => ({
          exclusiveReport: s.exclusiveReport
            ? { ...s.exclusiveReport, supervisor: ensured }
            : s.exclusiveReport,
        }));
      }
      await get().loadGatewayPrefs();
      return (
        isSupervisorGatewayOperational(ensured) &&
        !(report?.externalGatewayConflict ?? false)
      );
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      set({ lastError: sanitizeUserFacingCopy(`回收本机服务控制权失败：${raw.slice(0, TRUNCATE_ERROR)}`) });
      return false;
    }
  },

  probeCapabilities: async () => {
    if (get().connState !== "connected") return;
    try {
      const caps = await probeGatewayCapabilities();
      set({ gatewayCapabilities: caps });
    } catch {
      /* silent */
    }
  },

  loadGatewayPrefs: async () => {
    const prefs = loadLocalPrefs();

    if (!isTauriRuntime()) {
      if (prefs.wsUrl) set({ wsUrl: prefs.wsUrl });
      const legacyToken = getItem(LS_TOKEN)?.trim();
      if (legacyToken) set({ token: legacyToken });
      return;
    }

    purgeLegacyGatewayTokenOverride();

    let creds = await getGatewayConnectCredentialsWithRetry().catch(() => null);
    if (!creds?.token?.trim()) {
      creds = await getGatewayConnectCredentialsWithRetry(2, 350).catch(() => null);
    }
    const port = creds?.port ?? DEFAULT_PORT;
    const host = creds?.host ?? "127.0.0.1";
    const envToken = creds?.token?.trim() ?? "";
    const built = buildGatewayWsUrl(host, port);
    const token = envToken;
    const savedWs = prefs.wsUrl?.trim();
    const wsUrl =
      savedWs && savedWs.includes(`${host}:${port}`) ? savedWs.split("?")[0]! : built;

    set({ wsUrl, token });
    persistLocalPrefs(wsUrl);
  },

  cancelReconnect: () => {
    const t = get().reconnectTimer;
    if (t) clearTimeout(t);
    set({ reconnectTimer: null, reconnectDueAt: null, reconnectDelayMs: 0 });
  },

  scheduleReconnect: () => {
    const attempt = get().reconnectAttempt;
    const rateLimited = isGatewayRateLimitedError(get().lastError ?? "");
    scheduleReconnectAfter(backoffMs(attempt, rateLimited), { rateLimited });
  },

  disconnect: () => {
    /* bump generation so any in-flight connect() aborts harmlessly
     * instead of racing to re-set connState=connected after a user-initiated disconnect */
    gatewayConnectFlight.generation += 1;
    invalidateConnectPipeline();
    stopConnectionMonitor();
    get().cancelReconnect();
    clearConnectDeferredSyncTimer();
    performGatewayDisconnect({ stopActiveTask: true });
    set({
      connState: "disconnected",
      serverInfo: null,
      gatewayCapabilities: null,
      reconnectDueAt: null,
      reconnectDelayMs: 0,
      healthLatencyMs: null,
      connectionQuality: "unknown",
      startupPhase: null,
    });
    useAgentStore.getState().clearAgents();
  },

  connect: async (opts) => {
    const myGen = ++gatewayConnectFlight.generation;
    gatewayConnectFlight.connStateBeforeConnect = get().connState;
    if (gatewayConnectFlight.inFlight) {
      await gatewayConnectFlight.inFlight.catch(() => undefined);
      if (get().connState === "connected") return;
      if (myGen !== gatewayConnectFlight.generation) return;
    }

    gatewayConnectFlight.inFlight = withTimeout((async () => {
    if (isTauriRuntime() && !opts?.skipPrepare) {
      await prepareGatewayForConnect();
      if (myGen !== gatewayConnectFlight.generation) return;
    }
    if (isTauriRuntime() && !get().token.trim()) {
      purgeLegacyGatewayTokenOverride();
      await get().loadGatewayPrefs();
      if (myGen !== gatewayConnectFlight.generation) return;
    }
    const { wsUrl } = get();
    const gwToken = get().token.trim();
    if (isTauriRuntime() && !gwToken) {
      throw new Error(
        `未读取到网关 Token。请确认${SERVICE_PATH_LABELS.dataDir}/.env 存在，或到「软件设置 → 本机服务」点「从 .env 重新加载」；Owner 可「恢复默认连接参数」后重连。若反复出现，请检查启动日志 yuntuai-crash.log / yuntuai-startup.log（在安装目录下）。`,
      );
    }
    stopConnectionMonitor();
    clearConnectDeferredSyncTimer();
    get().cancelReconnect();
    /* 新 WebSocket 与旧连接无关：必须重新 sessions.messages.subscribe，否则走缓存会跳过订阅，chat 事件与部分会话状态会异常 */
    clearSessionSubscriptionTracking();
    resetNativeSendCapabilityCache();
    set({ connState: "connecting", lastError: null });

    const client = getGatewayClient();
    client.setHandlers({
      onEvent: (event, payload) => {
        if (myGen !== gatewayConnectFlight.generation) return;
        const noop = isGatewayNoopEvent(event);
        /* 心跳/tick 等保活事件不应延长「等回复」空闲计时，否则模型卡住时永远等不到超时兜底 */
        if (!noop) {
          setLastAnyWsEventMs(Date.now());
        }
        useExecApprovalStore.getState().handleGatewayEvent(event, payload);
        if (event === "sessions.changed") {
          handleGatewaySessionsChanged(payload, {
            resubscribeAll: (opts) => useSessionStore.getState().resubscribeAllRemoteSessions(opts),
            subscribeKey: async (key) => {
              try {
                await ensureSessionsMessagesSubscribed(getGatewayClient(), key);
              } catch {
                /* ignore */
              }
            },
            getActiveSession: () => {
              const st = useSessionStore.getState();
              const active = st.activeId
                ? st.sessions.find((s) => s.id === st.activeId)
                : undefined;
              return active ? { id: active.id, remoteSessionKey: active.remoteSessionKey } : null;
            },
            backfillActive: (sessionId) =>
              useSessionStore.getState().backfillHistoryFromGateway(sessionId, {
                reload: true,
                silent: true,
              }),
          });
        }
        /* 仅在当前 sendMessage 轮次内记录时间线步骤，避免轮次结束后
         * 晚到的 WebSocket 事件（如工具结束帧）仍创建 running 步骤，
         * 导致 UI 残留「任务执行中」或「任务流进行中」。 */
        if (shouldIngestSteps() && !noop) {
          queueStepIngest(event, payload);
        }
        if (event === "chat") {
          void applyGatewayChatEvent(payload).catch((err) => {
            if (get().connState !== "connected") return;
            const msg = err instanceof Error ? err.message : String(err);
            useUiStore.getState().showToast(`消息同步失败：${msg.slice(0, TRUNCATE_TOAST_SHORT)}`, "error");
          });
        }
        /* 网关 2026.5+ 在连接成功后自动推送 health 事件，用作即时延迟数据 */
        if (event === "health" && payload && typeof payload === "object" && "ok" in payload) {
          const durationMs = (payload as Record<string, unknown>).durationMs;
          if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
            recordHealthSample(Math.round(durationMs));
          }
        }
      },
      onUnexpectedClose: ({ code, reason }) => {
        if (myGen !== gatewayConnectFlight.generation) return;
        if (get().connState === "disconnected") return;
        stopConnectionMonitor();
        clearConnectDeferredSyncTimer();
        const willAutoRecover = get().autoReconnect && !shouldDeferAutoReconnect();
        if (willAutoRecover) {
          gatewayConnectFlight.suppressNextReconnectSuccessToast = true;
        }
        performGatewayDisconnect();
        // 自动重连中用 connecting，避免顶栏长期「异常」误报
        set({
          connState: willAutoRecover ? "connecting" : "error",
          lastError: willAutoRecover ? null : "连接已断开",
          serverInfo: null,
          healthLatencyMs: null,
          connectionQuality: "unknown",
        });
        const attempt = get().reconnectAttempt;
        const st = get();
        const runAbnormalCloseRecovery = () => {
          void (async () => {
            if (!tryBeginGatewayRecoveryOrSchedule(runAbnormalCloseRecovery)) return;
            try {
              const r = await runAbnormalCloseStrategy({
                code,
                reason,
                autoRemediate: st.autoRemediateOpenClaw,
                wsUrl: st.wsUrl,
                reconnectAttempt: attempt,
              });
              if (myGen !== gatewayConnectFlight.generation || get().connState === "disconnected") return;
              const autoRecover =
                get().autoReconnect && (r.followUp === "reconnect" || r.followUp === "reconnect_soon");
              if (autoRecover) {
                gatewayConnectFlight.suppressNextReconnectSuccessToast = true;
                set({
                  lastError: null,
                  gatewayLastIncident: r.incident,
                  connState: "connecting",
                  serverInfo: null,
                });
              } else {
                set({
                  lastError: r.displayError,
                  gatewayLastIncident: r.incident,
                  connState: "error",
                  serverInfo: null,
                });
                applyGatewayToasts(r.toasts, useUiStore.getState().showToast);
              }
              get().cancelReconnect();
              if (r.followUp === "reconnect_soon") {
                scheduleReconnectSoon();
                return;
              }
              if (r.followUp === "reconnect") {
                get().scheduleReconnect();
              }
            } finally {
              endGatewayRecovery();
            }
          })();
        };
        runAbnormalCloseRecovery();
      },
    });

    try {
      await client.connect(wsUrl, gwToken);
      if (myGen !== gatewayConnectFlight.generation) return;
      /*
       * 握手成功后立刻标为已连接。网关日志里常见「ready」后仍有一小段时间 chat.history / models.list 返回
       * UNAVAILABLE；若此处继续阻塞在 status / sessions.subscribe，界面会长期「连接中…」。
       */
      set({
        connState: "connected",
        lastError: null,
        gatewayLastIncident: null,
        reconnectAttempt: 0,
        serverInfo: null,
        startupPhase: null,
      });
      runConnectedSideEffects(myGen);

      void (async () => {
        let status: unknown = null;
        let health: unknown = null;
        let healthStart = performance.now();
        for (let attempt = 0; attempt < CONNECT_POST_HANDSHAKE_RETRIES; attempt++) {
          if (myGen !== gatewayConnectFlight.generation || get().connState !== "connected") return;
          await sleepMs(attempt === 0 ? CONNECT_POST_HANDSHAKE_DEFER_MS : 1_000);
          if (myGen !== gatewayConnectFlight.generation || get().connState !== "connected") return;
          healthStart = performance.now();
          [status, health] = await Promise.all([
            rpcWithTimeout("status", () => client.request<unknown>("status", {}), CONNECT_POST_HANDSHAKE_PROBE_MS),
            rpcWithTimeout("health", () => client.request<unknown>("health", {}), CONNECT_POST_HANDSHAKE_PROBE_MS),
          ]);
          if (status != null && health != null) break;
        }
        if (myGen !== gatewayConnectFlight.generation || get().connState !== "connected") return;
        if (health != null) {
          recordHealthSample(Math.round(performance.now() - healthStart));
        } else if (status != null) {
          recordHealthSample(50);
        }
        const summary = sanitizeUserFacingCopy(JSON.stringify({ status, health }).slice(0, 400));
        set({ serverInfo: summary });
        if (status == null || health == null) {
          console.warn("[gateway] post-connect status/health probe incomplete (non-fatal)");
        } else {
          set({ lastError: null });
        }
      })().catch(() => undefined);
    } catch (e) {
      if (myGen !== gatewayConnectFlight.generation) return;
      stopConnectionMonitor();
      /* 已握手成功但后续探测失败：断开 WebSocket 防止资源泄漏与过期事件 */
      performGatewayDisconnect();
      const st = get();
      const errorMsg = e instanceof Error ? e.message : String(e);

      /* 认证限流：回收端口并重启监管网关清空计数器后短延迟重试一次 */
      if (isGatewayRateLimitedError(errorMsg)) {
        await repairGatewayConnection({ waitMs: 1_500 });
        await cliGatewaySupervisorRestart().catch(() => null);
        await sleepMs(2_500);
        await get().loadGatewayPrefs();
        const retryToken = get().token.trim();
        if (retryToken) {
          try {
            await getGatewayClient().connect(st.wsUrl, retryToken);
            if (myGen !== gatewayConnectFlight.generation) return;
            set({
              connState: "connected",
              lastError: null,
              gatewayLastIncident: null,
              reconnectAttempt: 0,
              serverInfo: null,
              startupPhase: null,
            });
            runConnectedSideEffects(myGen);
            return;
          } catch {
            /* 继续走 recovery 策略（含退避等待） */
          }
        }
      }

      /* token_mismatch：清缓存并以 .env 重启监管网关后再握手（保留原有完整 handlers，勿覆盖为 stub） */
      if (isGatewayAuthError(errorMsg) && !isGatewayRateLimitedError(errorMsg)) {
        await repairGatewayConnection();
        await get().loadGatewayPrefs();
        const retryToken = get().token.trim();
        if (retryToken) {
          try {
            const client2 = getGatewayClient();
            await client2.connect(st.wsUrl, retryToken);
            if (myGen !== gatewayConnectFlight.generation) return;
            set({
              connState: "connected",
              lastError: null,
              gatewayLastIncident: null,
              reconnectAttempt: 0,
              serverInfo: null,
              startupPhase: null,
            });
            runConnectedSideEffects(myGen);
            rpcWithTimeout("health", () => client2.request<unknown>("health", {}), 4_000)
              .then((h) => { if (h) recordHealthSample(50); })
              .catch(() => undefined);
            return;
          } catch {
            /* 继续走 recovery 策略 */
          }
        }
      }

      const inConnectPipeline = isConnectOrchestrationInFlight();
      set({
        connState: inConnectPipeline ? "connecting" : "error",
        lastError: errorMsg || "连接本机服务失败",
        serverInfo: null,
      });
      get().cancelReconnect();

      if (inConnectPipeline) {
        return;
      }

      void runConnectFailureStrategy({
        error: e,
        autoRemediate: st.autoRemediateOpenClaw,
        wsUrl: st.wsUrl,
        reconnectAttempt: st.reconnectAttempt,
      }).then((r) => {
        if (myGen !== gatewayConnectFlight.generation || get().connState === "disconnected") return;
        set({
          lastError: r.displayError,
          gatewayLastIncident: r.incident,
        });
        applyGatewayToasts(r.toasts, useUiStore.getState().showToast);
        get().cancelReconnect();
        const rateDelay =
          r.reconnectDelayMs ??
          connectFailureReconnectDelayMs(errorMsg, st.reconnectAttempt) ??
          undefined;
        if (r.followUp === "reconnect_soon") {
          scheduleReconnectSoon();
        } else if (r.followUp === "reconnect") {
          if (rateDelay != null) {
            scheduleReconnectAfter(rateDelay, { rateLimited: true });
          } else {
            get().scheduleReconnect();
          }
        }
      }).catch(() => {
        if (myGen !== gatewayConnectFlight.generation || get().connState === "disconnected") return;
        set({
          lastError: "连接本机服务失败，将尝试自动重连…",
          connState: "error",
          gatewayLastIncident: null,
        });
        get().cancelReconnect();
        if (get().autoReconnect) {
          scheduleReconnectSoon();
        }
      });

      return;
    }
    })(), GATEWAY_CONNECT_MAX_MS, "gatewayConnect");

    try {
      await gatewayConnectFlight.inFlight;
    } catch (e) {
      if (myGen !== gatewayConnectFlight.generation) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("超时") || /timeout/i.test(msg)) {
        gatewayConnectFlight.generation += 1;
        stopConnectionMonitor();
        performGatewayDisconnect();
        const inPipeline = isConnectOrchestrationInFlight();
        const willAutoRecover = get().autoReconnect && !inPipeline;
        if (willAutoRecover) {
          gatewayConnectFlight.suppressNextReconnectSuccessToast = true;
        }
        set({
          connState: inPipeline || willAutoRecover ? "connecting" : "error",
          lastError:
            "连接本机服务超时。界面已解锁，可到「软件设置 → 本机服务」手动重连。",
        });
        get().cancelReconnect();
        if (willAutoRecover) {
          scheduleReconnectSoon();
        }
      }
    } finally {
      gatewayConnectFlight.inFlight = null;
    }
  },
  };
});

