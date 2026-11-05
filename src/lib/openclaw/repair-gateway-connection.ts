import { isTauriRuntime } from "../tauri-env";
import {
  cliGatewaySupervisorReclaim,
  cliGatewaySupervisorStatus,
  cliOpenClawExclusiveReport,
  cliStopAllGateways,
  cliSuppressExternalOpenClaw,
} from "./cli-bridge";
import { repairServiceConfig } from "./service-config-repair";
import { isSupervisorGatewayOperational, sleepMs } from "./connection-resilience";
import { fetchGatewayLifecycleSnapshot, shouldSkipHeavyGatewayPrep } from "./gateway-lifecycle";
import { autoRecoverSupervisorGateway } from "./auto-supervisor-recovery";
import { purgeLegacyGatewayTokenOverride } from "../../stores/gateway-store-constants";

/**
 * 连接前回收孤儿网关并以 openclaw-data/.env 启动监管实例。
 * 已在 YunTuAI 监管下且健康时跳过，避免重连风暴里反复 stop_all 杀活网关。
 */
export async function repairGatewayConnection(opts?: { waitMs?: number }): Promise<boolean> {
  if (!isTauriRuntime()) return false;

  await cliSuppressExternalOpenClaw().catch(() => null);

  const [st, report] = await Promise.all([
    cliGatewaySupervisorStatus().catch(() => null),
    cliOpenClawExclusiveReport().catch(() => null),
  ]);
  if (isSupervisorGatewayOperational(st) && !report?.externalGatewayConflict) {
    return true;
  }

  const repaired = await repairServiceConfig().catch(() => null);
  if (repaired?.changed) {
    await sleepMs(400);
  }

  purgeLegacyGatewayTokenOverride();

  if (report?.externalGatewayConflict) {
    const snap = await fetchGatewayLifecycleSnapshot();
    if (!shouldSkipHeavyGatewayPrep(snap)) {
      await cliStopAllGateways().catch(() => null);
    }
    await cliGatewaySupervisorReclaim().catch(() => null);
  } else if (!isSupervisorGatewayOperational(st)) {
    /* 内置孤儿网关：监管恢复会接管端口，勿先 stop_all 误杀可用实例 */
    if (await autoRecoverSupervisorGateway()) {
      await sleepMs(opts?.waitMs ?? 1_000);
      return true;
    }
    const snap = await fetchGatewayLifecycleSnapshot();
    if (!shouldSkipHeavyGatewayPrep(snap)) {
      await cliStopAllGateways().catch(() => null);
    }
    await cliGatewaySupervisorReclaim().catch(() => null);
  }

  const recovered = await autoRecoverSupervisorGateway();
  await sleepMs(opts?.waitMs ?? 1_000);
  return recovered;
}
