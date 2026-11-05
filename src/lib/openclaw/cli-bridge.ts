import { invokeAuthed } from "../tauri-invoke";
import { PRODUCT_NAME } from "../product-brand";
import { withTimeout } from "../async-utils";
import { withInvokeRetries } from "./connection-resilience";

/** 常规 IPC 超时，避免服务不可达时堵死 WebView invoke 池 */
const IPC_TIMEOUT_MS = 8_000;
/** 轻量 status 查询用更短超时 */
const IPC_STATUS_TIMEOUT_MS = 3_000;
/** reclaim / restart 等重型操作 */
const IPC_HEAVY_TIMEOUT_MS = 12_000;

export type GatewayCliResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type GatewaySupervisorStatus = {
  supervised: boolean;
  pid: number | null;
  running: boolean;
  healthOk: boolean;
  message: string;
};

export type OpenClawExclusiveReport = {
  supervisor: GatewaySupervisorStatus;
  bundledReady: boolean;
  globalOpenclawInPath: boolean;
  globalOpenclawVersion: string | null;
  legacyHomeOpenclawExists: boolean;
  legacyHomeOpenclawDir: string | null;
  dataDir: string | null;
  gatewayProbeRunning: boolean | null;
  externalGatewayConflict: boolean;
  portReachable?: boolean;
  warnings: string[];
};

export type OpenClawDirStatus = { dir: string; exists: boolean };

export type GatewayConnectCredentials = {
  host: string;
  port: number;
  token: string | null;
};

export type CliBridgeFailure = {
  cmd: string;
  message: string;
  at: number;
};

let lastCliBridgeFailure: CliBridgeFailure | null = null;

/** 最近一次 cli-bridge IPC 失败（safe/critical 均会写入），供诊断导出。 */
export function getLastCliBridgeFailure(): CliBridgeFailure | null {
  return lastCliBridgeFailure;
}

export function clearLastCliBridgeFailure(): void {
  lastCliBridgeFailure = null;
}

function isExpectedCliFailure(message: string): boolean {
  return /未登录|会话无效|会话已过期|返回空|timeout|超时|IPC .* 返回空/i.test(message);
}

const PROBE_CMDS = new Set([
  "gateway_supervisor_status",
  "openclaw_exclusive_report",
  "get_gateway_connect_credentials",
  "openclaw_gateway_health_json",
  "openclaw_dir_status",
  "openclaw_control_discover",
  "openclaw_control_ai_access_status",
  "openclaw_control_read_config",
]);

async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = IPC_TIMEOUT_MS,
): Promise<T | null> {
  try {
    const result = invokeAuthed<T>(cmd, args ?? {}, {
      critical: !PROBE_CMDS.has(cmd),
      timeoutMs,
    });
    return await withTimeout(result, timeoutMs, cmd);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lastCliBridgeFailure = { cmd, message, at: Date.now() };
    if (isExpectedCliFailure(message)) {
      console.debug(`[cli-bridge] safeInvoke ${cmd}:`, message);
    } else {
      console.error(`[cli-bridge] safeInvoke ${cmd} failed:`, e);
    }
    return null;
  }
}

/** 关键恢复路径：失败向上抛，调用方可写入 lastError / Toast。 */
async function criticalInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = IPC_TIMEOUT_MS,
): Promise<T> {
  try {
    const result = invokeAuthed<T>(cmd, args ?? {}, { critical: true, timeoutMs });
    const value = await withTimeout(result, timeoutMs, cmd);
    if (value == null) {
      const message = `IPC ${cmd} 返回空（未登录或运行时不可用）`;
      lastCliBridgeFailure = { cmd, message, at: Date.now() };
      throw new Error(message);
    }
    return value;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    lastCliBridgeFailure = { cmd, message, at: Date.now() };
    if (isExpectedCliFailure(message)) {
      console.debug(`[cli-bridge] criticalInvoke ${cmd}:`, message);
    } else {
      console.error(`[cli-bridge] criticalInvoke ${cmd} failed:`, e);
    }
    throw e instanceof Error ? e : new Error(message);
  }
}

export async function cliGatewayHealthJson(url?: string | null): Promise<GatewayCliResult | null> {
  return safeInvoke<GatewayCliResult>("openclaw_gateway_health_json", { url: url ?? null });
}

export async function cliGatewayStart(): Promise<GatewayCliResult | null> {
  return safeInvoke<GatewayCliResult>("openclaw_gateway_start");
}

export async function cliGatewayStop(): Promise<GatewayCliResult | null> {
  return safeInvoke<GatewayCliResult>("openclaw_gateway_stop");
}

export async function cliStopAllGateways(): Promise<void> {
  await safeInvoke<void>("openclaw_stop_all_gateways", {}, 30_000);
}

/** 仅关闭 PATH/计划任务等外部 OpenClaw 网关，保留 YunTuAI 内置监管实例。 */
export async function cliSuppressExternalOpenClaw(): Promise<void> {
  await safeInvoke<void>("openclaw_suppress_external");
}

export async function cliGatewayRestart(): Promise<GatewayCliResult | null> {
  return safeInvoke<GatewayCliResult>("openclaw_gateway_restart");
}

let lastStatus: GatewaySupervisorStatus | null = null;
let lastStatusAt = 0;
const STATUS_CACHE_MS = 700;

export async function cliGatewaySupervisorStatus(): Promise<GatewaySupervisorStatus | null> {
  const now = Date.now();
  if (lastStatus && now - lastStatusAt < STATUS_CACHE_MS) {
    return lastStatus;
  }
  const st = await safeInvoke<GatewaySupervisorStatus>(
    "gateway_supervisor_status",
    {},
    IPC_STATUS_TIMEOUT_MS,
  );
  if (st) {
    lastStatus = st;
    lastStatusAt = Date.now();
  }
  return st;
}

export async function cliGatewaySupervisorEnsure(): Promise<GatewaySupervisorStatus | null> {
  try {
    return await criticalInvoke<GatewaySupervisorStatus>("gateway_supervisor_ensure");
  } catch {
    return null;
  }
}

export async function cliGatewaySupervisorStop(): Promise<GatewaySupervisorStatus | null> {
  return safeInvoke<GatewaySupervisorStatus>("gateway_supervisor_stop");
}

export async function cliGatewaySupervisorRestart(): Promise<GatewaySupervisorStatus | null> {
  try {
    return await criticalInvoke<GatewaySupervisorStatus>(
      "gateway_supervisor_restart",
      {},
      IPC_HEAVY_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

/** 中转站：强制写入内嵌 API Key 并重启监管网关 */
export async function cliResyncRelayApiKey(): Promise<{
  keyFingerprint: string;
  gatewayRestarted: boolean;
} | null> {
  return safeInvoke("openclaw_resync_relay_api_key_cmd", {}, 20_000);
}

export async function cliOpenClawExclusiveReport(opts?: {
  full?: boolean;
}): Promise<OpenClawExclusiveReport | null> {
  return safeInvoke<OpenClawExclusiveReport>("openclaw_exclusive_report", {
    full: opts?.full ?? false,
  });
}

export async function cliGatewaySupervisorReclaim(): Promise<OpenClawExclusiveReport | null> {
  try {
    return await criticalInvoke<OpenClawExclusiveReport>(
      "gateway_supervisor_reclaim",
      {},
      IPC_HEAVY_TIMEOUT_MS,
    );
  } catch {
    return null;
  }
}

export type OpenClawControlDiscovery = {
  bundledReady: boolean;
  globalOpenclawInPath: boolean;
  globalOpenclawVersion: string | null;
  legacyHomeExists: boolean;
  legacyHomeDir: string | null;
  managedDataDir: string;
  managedDataExists: boolean;
  legacyRichnessScore: number;
  migrationRecommended: boolean;
  hasAdoptedManifest: boolean;
  recommendedAction: string;
};

export type OpenClawLegacyMigrationResult = {
  ok: boolean;
  legacyDir: string;
  targetDir: string;
  copiedDirs: string[];
  copiedFiles: string[];
  skipped: string[];
  mergedEnv: boolean;
  mergedConfig: boolean;
  legacyRenamedTo: string | null;
  message: string;
};

export type OpenClawConfigFileView = {
  name: string;
  path: string;
  exists: boolean;
  content?: string | null;
  sha256?: string | null;
  error?: string | null;
};

export type OpenClawControlEnforceResult = {
  ok: boolean;
  driftDetected: boolean;
  driftFiles: string[];
  restoredFiles: string[];
  sealed: boolean;
  message: string;
};

export type AbsoluteControlResult = {
  ok: boolean;
  adopted: boolean;
  policyApplied: boolean;
  secretsSealed: boolean;
  externalGatewaysStopped: boolean;
  configEnforced: boolean;
  driftRestored: string[];
  message: string;
};

export async function cliOpenClawControlDiscover(): Promise<OpenClawControlDiscovery | null> {
  return safeInvoke<OpenClawControlDiscovery>("openclaw_control_discover");
}

export async function cliOpenClawControlAdopt(preferLegacyHome = false): Promise<unknown> {
  return safeInvoke("openclaw_control_adopt", { preferLegacyHome });
}

export async function cliOpenClawMigrateFromLegacy(
  renameLegacy = true,
): Promise<OpenClawLegacyMigrationResult | null> {
  return safeInvoke<OpenClawLegacyMigrationResult>("openclaw_migrate_from_legacy", {
    renameLegacy,
  });
}

export async function cliOpenClawControlEnforce(restoreOnDrift = true): Promise<OpenClawControlEnforceResult | null> {
  return safeInvoke<OpenClawControlEnforceResult>("openclaw_control_enforce", { restoreOnDrift });
}

/**
 * 通过绝对管控 IPC 安全修改 openclaw.json（unseal → merge → write → 更新 vault → reseal）。
 * `patchJson` 会被 deep-merge 到现有配置中，仅影响指定字段。
 * 需要 Owner 权限。修改后需重启网关生效。
 */
export async function cliOpenClawControlWriteConfig(
  patchJson: Record<string, unknown>,
): Promise<OpenClawConfigFileView | null> {
  return safeInvoke<OpenClawConfigFileView>("openclaw_control_write_config", {
    patchJson,
  });
}

/**
 * 读取 openclaw.json 完整内容（含 sha256）。需要 Owner 权限。
 * 返回数组（目前仅 openclaw.json 一个文件，保留扩展性）。
 */
export async function cliOpenClawControlReadConfig(): Promise<OpenClawConfigFileView | null> {
  const files = await safeInvoke<OpenClawConfigFileView[]>("openclaw_control_read_config");
  if (!files || !Array.isArray(files) || files.length === 0) return null;
  return files[0] ?? null;
}

/** 查询 AI 完全访问模式开关状态 */
export async function cliAiAccessStatus(): Promise<boolean | null> {
  return safeInvoke<boolean>("openclaw_control_ai_access_status");
}

/** 设置 AI 完全访问模式开关（需要 Owner 权限） */
export async function cliSetAiAccess(enabled: boolean): Promise<boolean | null> {
  return safeInvoke<boolean>("openclaw_control_ai_access_set", { enabled });
}

/** openclaw-data 下的默认工作区路径 */
export async function openClawWorkspacePath(): Promise<string | null> {
  const st = await openclawDirStatus();
  if (!st?.dir) return null;
  return `${st.dir.replace(/\\/g, "/").replace(/\/$/, "")}/workspace`;
}

export async function openclawDirStatus(): Promise<OpenClawDirStatus | null> {
  return safeInvoke<OpenClawDirStatus>("openclaw_dir_status");
}

export async function getGatewayConnectCredentials(): Promise<GatewayConnectCredentials | null> {
  return safeInvoke<GatewayConnectCredentials>(
    "get_gateway_connect_credentials",
    undefined,
    IPC_HEAVY_TIMEOUT_MS,
  );
}

/** 桌面 IPC 偶发忙/初始化竞态时重试拉取网关凭据。 */
export async function getGatewayConnectCredentialsWithRetry(
  attempts = 4,
  baseDelayMs = 200,
): Promise<GatewayConnectCredentials | null> {
  const creds = await withInvokeRetries(
    () => getGatewayConnectCredentials(),
    { attempts, baseDelayMs },
  );
  if (creds?.token?.trim()) return creds;
  return getGatewayConnectCredentials();
}

/** OpenClaw 已集成在客户端内，禁止在资源管理器中直接打开数据目录。 */
export async function openOpenClawDataDirInOs(): Promise<void> {
  throw new Error(`本机服务已集成在 ${PRODUCT_NAME} 内，请通过软件设置管理本机服务，不支持独立打开配置目录。`);
}
