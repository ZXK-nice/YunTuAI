import { useEffect } from "react";
import { invokeAuthed } from "../lib/tauri-invoke";
import { isTauriRuntime } from "../lib/tauri-env";
import {
  cliSuppressExternalOpenClaw,
} from "../lib/openclaw/cli-bridge";
import { isConnectOrchestrationInFlight } from "../lib/connect-with-feedback";
import { isSupervisorGatewayOperational } from "../lib/openclaw/connection-resilience";
import {
  endGatewayRecovery,
  isGatewayRecoveryInFlight,
  tryBeginGatewayRecoveryOrSchedule,
} from "../lib/openclaw/gateway-recovery-lock";
import {
  applyLaunchStartupGrace,
  isInStartupGrace,
  markGatewayRecoveryAppStart,
} from "../lib/openclaw/gateway-recovery";
import {
  cancelBootConnectRetries,
  scheduleBootConnectRetries,
} from "../lib/openclaw/boot-connect-retry";
import {
  applyLaunchConnectProfile,
  getLaunchConnectProfile,
} from "../lib/openclaw/launch-connect-profile";
import {
  initAutoDisconnectDiagnostic,
  maybeRunAutoDisconnectDiagnostic,
} from "../lib/openclaw/auto-disconnect-diagnose";
import { requestDesktopConnect } from "../lib/openclaw/desktop-connect-scheduler";
import {
  ensureGatewayLifecycleListener,
  fetchGatewayLifecycleSnapshot,
} from "../lib/openclaw/gateway-lifecycle";
import { autoRecoverSupervisorGateway } from "../lib/openclaw/auto-supervisor-recovery";
import {
  listenGatewayExclusiveReport,
  listenGatewaySupervisorUnhealthy,
  listenMainWindowShown,
} from "../lib/openclaw/gateway-events";
import { runStartupUpdateCheck } from "../components/settings/AppUpdatePanel";
import { fetchLaunchContext } from "../lib/app-launch-bridge";
import { restoreLastActiveSessionAfterLoad } from "../stores/sessionStore";
import { withTimeout } from "../lib/async-utils";
import { runComposerDraftMaintenance } from "../lib/chat/composer-draft-prefs";
import { useGatewayStore } from "../stores/gatewayStore";
import { purgeLegacyGatewayTokenOverride } from "../stores/gateway-store-constants";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useOwnerStore } from "../stores/ownerStore";
import { useModelStore } from "../stores/modelStore";
import { useGatewayWakeProbe } from "./useGatewayWakeProbe";
import { useOpenClawDataDirNotice } from "./useOpenClawDataDirNotice";

let conflictRepairInFlight = false;
let lastConflictRepairAt = 0;
const CONFLICT_REPAIR_COOLDOWN_MS = 15_000;

/** StrictMode 双挂载时避免误 disconnect 活跃连接 */
let bootstrapMountRefs = 0;

const WATCHDOG_MS = 120_000;
const BOOTSTRAP_DISCONNECT_DEBOUNCE_MS = 300;
const UNHEALTHY_RECOVERY_COOLDOWN_MS = 20_000;

let unhealthyRecoveryInFlight = false;
let lastUnhealthyRecoveryAt = 0;
/** 已连接时单次 health 失败不立刻 disconnect（长推理后常见） */
let connectedUnhealthyFailStreak = 0;
const CONNECTED_UNHEALTHY_FAILS_BEFORE_RECONNECT = 2;
const SUPERVISOR_ENSURE_TIMEOUT_MS = 45_000;

async function runPeriodicWatchdog() {
  const gw = useGatewayStore.getState();
  const connected = gw.connState === "connected";
  const operational = isSupervisorGatewayOperational(gw.exclusiveReport?.supervisor ?? null);

  const trimmedDrafts = runComposerDraftMaintenance(
    useSessionStore.getState().sessions.map((s) => s.id),
  );
  useUiStore.setState((s) =>
    s.composerDrafts === trimmedDrafts ? s : { composerDrafts: trimmedDrafts },
  );

  if (!connected && !operational) {
    await cliSuppressExternalOpenClaw().catch(() => undefined);
  }
  if (!connected && gw.autoReconnect) {
    await gw.refreshExclusiveReport();
  }
  const report = useGatewayStore.getState().exclusiveReport;
  if (
    report?.externalGatewayConflict &&
    !isSupervisorGatewayOperational(report.supervisor) &&
    gw.connState !== "connected" &&
    !isInStartupGrace()
  ) {
    await requestDesktopConnect({
      context: "回收未监管网关后重连",
      direct: true,
      forceRepair: true,
      maxMs: getLaunchConnectProfile().startupConnectMaxMs,
    });
  }
  await maybeRunAutoDisconnectDiagnostic();
}

let deferredDbMaintenanceTimer: ReturnType<typeof setTimeout> | undefined;

function runDeferredDbMaintenance() {
  if (!isTauriRuntime() || import.meta.env.MODE === "test") return;
  if (deferredDbMaintenanceTimer != null) {
    window.clearTimeout(deferredDbMaintenanceTimer);
  }
  deferredDbMaintenanceTimer = window.setTimeout(() => {
    deferredDbMaintenanceTimer = undefined;
    void (async () => {
      try {
        const result = await invokeAuthed<{
          integrityOk: boolean;
          integrityDetail: string;
          schemaVersion?: number;
          expectedSchemaVersion?: number;
          auditDeletedByAge: number;
          auditDeletedByCap: number;
          sessionsDeleted: number;
          messagesDeleted: number;
          tasksDeleted: number;
          loginAttemptsDeleted: number;
          tokensDeleted: number;
          walCheckpointed: boolean;
          vacuumRan: boolean;
          backupPath: string | null;
        }>("db_run_maintenance");
        if (result && !result.integrityOk) {
          useUiStore
            .getState()
            .showToast(`本机数据库 quick_check 未通过。${result.integrityDetail.slice(0, 180)}`, "error");
        }
        if (
          result?.schemaVersion != null &&
          result.expectedSchemaVersion != null &&
          result.schemaVersion < result.expectedSchemaVersion
        ) {
          useUiStore
            .getState()
            .showToast(
              `本机数据库 schema 版本偏旧（${result.schemaVersion}），请更新客户端（需要 ${result.expectedSchemaVersion}）。`,
              "warning",
            );
        }
        if (result?.backupPath) {
          useUiStore.getState().showToast("已生成本地数据备份", "info");
        }
        const trimmedDrafts = runComposerDraftMaintenance(
          useSessionStore.getState().sessions.map((s) => s.id),
        );
        useUiStore.setState((s) =>
          s.composerDrafts === trimmedDrafts ? s : { composerDrafts: trimmedDrafts },
        );
      } catch {
        try {
          const integrity = await invokeAuthed<{
            ok: boolean;
            detail: string;
            schemaVersion?: number;
            expectedSchemaVersion?: number;
          }>("db_check_integrity");
          if (integrity && !integrity.ok) {
            useUiStore
              .getState()
              .showToast(`本机数据库 quick_check 未通过。${integrity.detail.slice(0, 180)}`, "error");
          }
          if (
            integrity?.schemaVersion != null &&
            integrity.expectedSchemaVersion != null &&
            integrity.schemaVersion < integrity.expectedSchemaVersion
          ) {
            useUiStore
              .getState()
              .showToast(
                `本机数据库 schema 版本偏旧（${integrity.schemaVersion}），请更新客户端（需要 ${integrity.expectedSchemaVersion}）。`,
                "warning",
              );
          }
          const path = await invokeAuthed<string | null>("db_try_autobackup");
          if (path) {
            useUiStore.getState().showToast("已生成本地数据备份", "info");
          }
        } catch {
          /* ignore */
        }
      }
    })();
    }, 45_000);
}

/** 加载连接参数、准备网关并连接 */
export function useAppBootstrap() {
  useGatewayWakeProbe();
  useOpenClawDataDirNotice();

  useEffect(() => {
    const isViteHmr = Boolean(import.meta.hot);
    bootstrapMountRefs += 1;
    let cancelled = false;
    let watchdog: ReturnType<typeof setInterval> | null = null;

    let unlistenReport: (() => void) | undefined;
    let unlistenUnhealthy: (() => void) | undefined;
    let unlistenMainWindow: (() => void) | undefined;

    const isCancelled = () => cancelled;

    const run = async () => {
      try {
        initAutoDisconnectDiagnostic();
        if (isTauriRuntime()) {
          purgeLegacyGatewayTokenOverride();
        }
        markGatewayRecoveryAppStart();
        ensureGatewayLifecycleListener();
        if (isTauriRuntime() && import.meta.env.MODE !== "test") {
          const launchCtx = await fetchLaunchContext();
          if (launchCtx?.startupGraceMs) {
            applyLaunchStartupGrace(launchCtx.startupGraceMs);
          }
          applyLaunchConnectProfile(launchCtx);
          // Rust auto-ensure 已在启动线程拉起；前端仅拉取 lifecycle，避免重复 recovery
          void fetchGatewayLifecycleSnapshot().catch(() => undefined);
        }
        if (isTauriRuntime() && import.meta.env.MODE !== "test") {
          window.setTimeout(() => {
            if (!cancelled) void useModelStore.getState().hydrate();
          }, 2_500);
          window.setTimeout(() => {
            if (cancelled) return;
            void useSessionStore
              .getState()
              .loadSessions()
              .then(() => {
                if (!cancelled) restoreLastActiveSessionAfterLoad();
              });
          }, 600);
          // ensure 由 post-login / desktop-connect-scheduler 统一发起，避免启动双 ensure 噪音
          void useGatewayStore.getState().refreshExclusiveReport().catch(() => undefined);
          unlistenReport = await listenGatewayExclusiveReport((report) => {
            useGatewayStore.getState().applyExclusiveReport(report);
            if (!report.externalGatewayConflict) return;
            if (isInStartupGrace()) return;
            if (isSupervisorGatewayOperational(report.supervisor)) return;
            const gw = useGatewayStore.getState();
            if (gw.connState === "connected" || useSessionStore.getState().isSending) return;
            const now = Date.now();
            if (conflictRepairInFlight || now - lastConflictRepairAt < CONFLICT_REPAIR_COOLDOWN_MS) {
              return;
            }
            if (isGatewayRecoveryInFlight()) return;
            conflictRepairInFlight = true;
            lastConflictRepairAt = now;
            void (async () => {
              try {
                await requestDesktopConnect({
                  context: "自动回收未监管网关",
                  direct: true,
                  forceRepair: true,
                  cancelled: isCancelled,
                  maxMs: getLaunchConnectProfile().startupConnectMaxMs,
                });
              } finally {
                conflictRepairInFlight = false;
              }
            })();
          });
          unlistenUnhealthy = await listenGatewaySupervisorUnhealthy(() => {
            if (useSessionStore.getState().isSending) return;
            const gw0 = useGatewayStore.getState();
            if (isInStartupGrace()) return;
            const gw = gw0;
            if (gw.connState === "connected") {
              if (unhealthyRecoveryInFlight) return;
              const now = Date.now();
              if (now - lastUnhealthyRecoveryAt < UNHEALTHY_RECOVERY_COOLDOWN_MS) return;
              void (async () => {
                unhealthyRecoveryInFlight = true;
                lastUnhealthyRecoveryAt = now;
                try {
                  const client = (await import("../lib/openclaw/gateway-runtime")).getGatewayClient();
                  await client.request("health", {}, { timeoutMs: 5_000 });
                  connectedUnhealthyFailStreak = 0;
                  void gw.refreshExclusiveReport();
                } catch {
                  connectedUnhealthyFailStreak += 1;
                  if (connectedUnhealthyFailStreak < CONNECTED_UNHEALTHY_FAILS_BEFORE_RECONNECT) {
                    return;
                  }
                  connectedUnhealthyFailStreak = 0;
                  const runConnectedUnhealthyRecovery = async () => {
                    if (!tryBeginGatewayRecoveryOrSchedule(runConnectedUnhealthyRecovery)) return;
                    useUiStore
                      .getState()
                      .showToast("本机服务异常，正在尝试恢复连接…", "info");
                    gw.cancelReconnect();
                    gw.disconnect();
                    try {
                      await withTimeout(
                        autoRecoverSupervisorGateway({ force: true }),
                        SUPERVISOR_ENSURE_TIMEOUT_MS,
                        "恢复本机服务",
                      );
                      await requestDesktopConnect({
                        context: "恢复本机服务",
                        direct: true,
                        skipPrepare: true,
                        cancelled: isCancelled,
                        maxMs: getLaunchConnectProfile().startupConnectMaxMs,
                      });
                    } catch {
                      /* connectWithFeedback 已写入 lastError */
                    } finally {
                      endGatewayRecovery();
                    }
                  };
                  await runConnectedUnhealthyRecovery();
                } finally {
                  unhealthyRecoveryInFlight = false;
                }
              })();
              return;
            }
            connectedUnhealthyFailStreak = 0;
            const now = Date.now();
            if (
              unhealthyRecoveryInFlight ||
              now - lastUnhealthyRecoveryAt < UNHEALTHY_RECOVERY_COOLDOWN_MS
            ) {
              return;
            }
            unhealthyRecoveryInFlight = true;
            lastUnhealthyRecoveryAt = now;
            const runDisconnectedUnhealthyRecovery = () => {
              if (!tryBeginGatewayRecoveryOrSchedule(runDisconnectedUnhealthyRecovery)) {
                unhealthyRecoveryInFlight = false;
                return;
              }
              if (useSessionStore.getState().isSending) {
                unhealthyRecoveryInFlight = false;
                endGatewayRecovery();
                return;
              }
              useUiStore
                .getState()
                .showToast("本机服务异常，正在尝试恢复…", "info");
              gw.cancelReconnect();
              gw.disconnect();
              void (async () => {
                try {
                  await withTimeout(
                    autoRecoverSupervisorGateway({ force: true }),
                    SUPERVISOR_ENSURE_TIMEOUT_MS,
                    "恢复本机服务",
                  );
                  await requestDesktopConnect({
                    context: "恢复本机服务",
                    direct: true,
                    skipPrepare: true,
                    cancelled: isCancelled,
                    maxMs: getLaunchConnectProfile().startupConnectMaxMs,
                  });
                } catch {
                  /* requestDesktopConnect 已写入 lastError */
                } finally {
                  endGatewayRecovery();
                  unhealthyRecoveryInFlight = false;
                }
              })();
            };
            runDisconnectedUnhealthyRecovery();
          });
          unlistenMainWindow = await listenMainWindowShown(() => {
            const gw = useGatewayStore.getState();
            if (gw.connState === "connected") return;
            if (gw.connState === "connecting" && isConnectOrchestrationInFlight()) return;
            if (useSessionStore.getState().isSending) return;
            const profile = getLaunchConnectProfile();
            void requestDesktopConnect({
              context: "打开主界面快速连接",
              direct: true,
              fastReopen: gw.connState !== "error",
              skipPrepare: gw.connState === "error",
              maxMs: profile.startupConnectMaxMs,
            });
          });
        }

        await useGatewayStore.getState().loadGatewayPrefs();
        // 登录后连接仅由 usePostLoginConnectGate 发起；此处再跑一遍会重复 establish/ensure，dev 下像整窗卡死。
        await useOwnerStore.getState().refresh();
        if (isTauriRuntime() && import.meta.env.MODE !== "test") {
          scheduleBootConnectRetries(isCancelled);
        }
        if (cancelled) return;

        if (import.meta.env.MODE !== "test") {
          if (isTauriRuntime()) {
            runDeferredDbMaintenance();
            window.setTimeout(() => {
              void runStartupUpdateCheck((msg, kind) => {
                useUiStore.getState().showToast(msg, kind);
              });
            }, 12_000);
            watchdog = window.setInterval(() => {
              void runPeriodicWatchdog().catch(() => undefined);
            }, WATCHDOG_MS);
          } else {
            await useGatewayStore.getState().connect().catch(() => undefined);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        useUiStore.getState().showToast(`启动失败：${msg.slice(0, 180)}`, "error");
      }
    };
    void run();

    const teardownListeners = () => {
      cancelBootConnectRetries();
      unlistenReport?.();
      unlistenUnhealthy?.();
      unlistenMainWindow?.();
      if (watchdog) clearInterval(watchdog);
      if (deferredDbMaintenanceTimer != null) {
        window.clearTimeout(deferredDbMaintenanceTimer);
        deferredDbMaintenanceTimer = undefined;
      }
    };

    if (isViteHmr && import.meta.hot) {
      import.meta.hot.dispose(() => {
        cancelled = true;
        teardownListeners();
      });
    }

    return () => {
      cancelled = true;
      teardownListeners();
      bootstrapMountRefs -= 1;
      if (isViteHmr) return;
      useGatewayStore.getState().cancelReconnect();
      window.setTimeout(() => {
        if (bootstrapMountRefs === 0) {
          useGatewayStore.getState().disconnect();
        }
      }, BOOTSTRAP_DISCONNECT_DEBOUNCE_MS);
    };
  }, []);
}
