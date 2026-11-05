import { isSupervisorGatewayOperational } from "./connection-resilience";
import { cliGatewaySupervisorStatus } from "./cli-bridge";
import { requestGatewaySupervisorRecovery } from "./gateway-lifecycle";
import { probeGatewayHealthLooksOk } from "./gateway-health-probe";

let recoverInFlight: Promise<boolean> | null = null;

async function supervisorAndHealthOk(): Promise<boolean> {
  const st = await cliGatewaySupervisorStatus().catch(() => null);
  if (!isSupervisorGatewayOperational(st)) return false;
  return probeGatewayHealthLooksOk();
}

/**
 * 自动恢复唯一入口：成功 = 监管进程在跑 **且** health JSON 通过。
 * 其它路径（连接失败策略、repair、prepare、限流重启）都应调用本函数，勿直接 IPC recover。
 * 用户手动「回收控制权」仍可直接 cliGatewaySupervisorEnsure/Reclaim。
 */
export async function autoRecoverSupervisorGateway(opts?: {
  /** 即使当前看起来健康也再走一次 supervisor recover（限流/换 Token）。 */
  force?: boolean;
}): Promise<boolean> {
  if (recoverInFlight) return recoverInFlight;
  recoverInFlight = (async () => {
    if (!opts?.force && (await supervisorAndHealthOk())) return true;
    await requestGatewaySupervisorRecovery().catch(() => null);
    return supervisorAndHealthOk();
  })().finally(() => {
    recoverInFlight = null;
  });
  return recoverInFlight;
}

/** 测试用：清掉单飞，避免用例互相卡住。 */
export function __resetAutoRecoverForTest(): void {
  recoverInFlight = null;
}
