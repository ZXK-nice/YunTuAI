/**

 * 网关连接成功后的稳定化管线：订阅恢复 → 历史回填 → 能力探测。

 * 稳定性优先：所有步骤失败均不抛错，仅记录结果供 UI/日志使用。

 */



import { getGatewayClient } from "./gateway-runtime";

import { probeGatewayCapabilities } from "./gateway-capabilities";

import { bootstrapCuratedSkills } from "./skill-bootstrap";

import { useGatewayStore } from "../../stores/gatewayStore";

import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { tryRecoverPendingSendAfterReconnect } from "./send-recovery";
import { runMemoryMaintenanceOnConnect } from "./memory-maintenance";



export type RuntimeStabilityReport = {

  resubscribed: boolean;

  activeBackfillAppended: number;

  bulkBackfillSessions: number;

  capabilitiesProbed: boolean;

  skillsBootstrapped: number;

  memoryMaintenance: boolean;

};



const BULK_BACKFILL_MAX = 3;

const BULK_BACKFILL_DEFER_MS = 4_500;



async function runBulkHistoryBackfill(activeId: string | null): Promise<number> {
  if (useSessionStore.getState().isSending) return 0;

  const sessions = useSessionStore.getState().sessions;

  const candidates = sessions

    .filter((s) => s.remoteSessionKey?.trim() && s.id !== activeId)

    .slice(0, BULK_BACKFILL_MAX);



  let bulkCount = 0;

  for (const sess of candidates) {

    const n = await useSessionStore

      .getState()

      .backfillHistoryFromGateway(sess.id, { reload: false, silent: true });

    if (n > 0) bulkCount += 1;

  }

  if (bulkCount > 0) {

    await useSessionStore.getState().loadSessions();

  }

  return bulkCount;

}



function scheduleBulkHistoryBackfill(activeId: string | null): void {

  const run = () => {

    if (useGatewayStore.getState().connState !== "connected") return;

    void runBulkHistoryBackfill(activeId).catch(() => undefined);

  };

  if (typeof requestIdleCallback !== "undefined") {

    requestIdleCallback(() => run(), { timeout: BULK_BACKFILL_DEFER_MS });

  } else {

    window.setTimeout(run, BULK_BACKFILL_DEFER_MS);

  }

}



/**

 * 连接稳定后执行：重订阅、活跃会话历史回填、批量静默回填、能力探测。

 */

export async function runPostConnectStabilityPipeline(opts?: {

  skipBulkBackfill?: boolean;

}): Promise<RuntimeStabilityReport> {

  const report: RuntimeStabilityReport = {

    resubscribed: false,

    activeBackfillAppended: 0,

    bulkBackfillSessions: 0,

    capabilitiesProbed: false,

    skillsBootstrapped: 0,

    memoryMaintenance: false,

  };



  if (useGatewayStore.getState().connState !== "connected") return report;



  const client = getGatewayClient();

  if (!client.isHelloOk) return report;



  const sessionStore = useSessionStore.getState();



  try {

    await sessionStore.syncRemoteForActive();

  } catch {

    /* ignore */

  }



  try {

    await sessionStore.resubscribeAllRemoteSessions({ background: true });

    report.resubscribed = true;

  } catch {

    /* ignore */

  }



  const activeId = sessionStore.activeId;

  if (activeId && !useSessionStore.getState().isSending) {

    const appended = await useSessionStore.getState().backfillHistoryFromGateway(activeId, {

      reload: true,

      silent: true,

    });

    report.activeBackfillAppended = appended;

    if (appended > 0) {

      await useSessionStore.getState().loadSessions();

    }

  }



  if (!opts?.skipBulkBackfill && !useSessionStore.getState().isSending) {

    scheduleBulkHistoryBackfill(activeId);

  }



  try {

    const caps = await probeGatewayCapabilities({ skipAgentsList: false, force: true });

    useGatewayStore.setState({ gatewayCapabilities: caps });

    report.capabilitiesProbed = true;



    const cov = caps.methodCoverage;

    if (cov && cov.coveragePercent < 92 && cov.missingIntegrated.length > 0) {

      useUiStore.getState().showToast(

        `网关 RPC 集成覆盖 ${cov.coveragePercent}%（${cov.missingIntegrated.length} 项缺失），部分办事能力可能受限。可在侧栏复制诊断信息。`,

        "info",

      );

    }

  } catch {

    /* ignore */

  }



  try {

    report.skillsBootstrapped = await bootstrapCuratedSkills();

  } catch {

    /* ignore */

  }



  try {

    const { useTaskStore } = await import("../../stores/taskStore");

    await useTaskStore.getState().loadRecent(20);

  } catch {

    /* ignore */

  }



  try {
    await tryRecoverPendingSendAfterReconnect();
  } catch {
    /* ignore */
  }

  try {
    const { useSessionStore } = await import("../../stores/sessionStore");
    await useSessionStore.getState().flushQueuedSendAfterReconnect();
  } catch {
    /* ignore */
  }

  try {
    void (async () => {
      await new Promise((r) => setTimeout(r, 10_000));
      try {
        const maint = await runMemoryMaintenanceOnConnect();
        if (!maint.repairOk || !maint.backfillOk) {
          console.warn("[YunTuAI] memory maintenance incomplete", maint);
        }
      } catch (err) {
        console.warn("[YunTuAI] memory maintenance failed", err);
      }
    })();
    report.memoryMaintenance = true;
  } catch {
    /* ignore */
  }

  return report;

}


