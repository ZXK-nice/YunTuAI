import { withTimeout } from "../async-utils";
import {
  connectWithFeedback,
  invalidateConnectPipeline,
  setConnectPipelinePhase,
} from "../connect-with-feedback";
import { prepareGatewayForConnect } from "./gateway-connect-preflight";
import { waitForGatewayReady } from "./gateway-ready-wait";
import { waitForEstablishComplete } from "./gateway-lifecycle";
import { getLaunchConnectProfile } from "./launch-connect-profile";
import { useGatewayStore } from "../../stores/gatewayStore";

export const GATEWAY_READY_MAX_MS = 12_000;
export const STARTUP_CONNECT_MAX_MS = 30_000;
/** prepareGatewayForConnect 上限，与 gateway-connect-preflight 对齐 */
export const STARTUP_PREPARE_MAX_MS = 12_000;
/** 重新打开且监管网关已在跑时的连接预算（prepare 12s + connect 22s + 缓冲） */
export const REOPEN_CONNECT_MAX_MS = 28_000;
/** 首次安装允许更长等待（解压 + 起网关 + 策略生效）。 */
export const FIRST_RUN_CONNECT_MAX_MS = 180_000;

/**
 * 启动时连接本机网关：等待 supervisor 就绪 → 准备环境 → WebSocket 握手。
 * @returns 是否握手成功
 */
export async function runStartupConnectPipeline(opts?: {
  maxMs?: number;
  cancelled?: () => boolean;
}): Promise<boolean> {
  const cancelled = opts?.cancelled ?? (() => false);
  const profile = getLaunchConnectProfile();
  const defaultMaxMs = profile.startupConnectMaxMs;
  const maxMs = opts?.maxMs ?? defaultMaxMs;
  const outerMaxMs =
    maxMs >= FIRST_RUN_CONNECT_MAX_MS
      ? maxMs
      : maxMs +
        Math.max(profile.gatewayReadyMaxMs, GATEWAY_READY_MAX_MS) +
        STARTUP_PREPARE_MAX_MS;
  const pipelineStartedAt = Date.now();
  const remainingPipelineMs = () =>
    Math.max(8_000, outerMaxMs - (Date.now() - pipelineStartedAt));

  const run = async (): Promise<boolean> => {
    if (cancelled()) return false;

    setConnectPipelinePhase("正在准备本机服务环境…");
    await waitForEstablishComplete({
      maxMs: maxMs >= FIRST_RUN_CONNECT_MAX_MS ? 90_000 : profile.postLoginGatewayWaitMs,
    });
    if (cancelled()) return false;

    setConnectPipelinePhase("正在连接本机服务…");
    const readyMaxMs =
      maxMs >= FIRST_RUN_CONNECT_MAX_MS
        ? 60_000
        : Math.max(profile.gatewayReadyMaxMs, GATEWAY_READY_MAX_MS);
    await waitForGatewayReady({ maxMs: readyMaxMs });
    if (cancelled()) return false;

    await prepareGatewayForConnect();
    if (cancelled()) return false;

    const ok = await connectWithFeedback(undefined, {
      skipPrepare: true,
      cancelled,
      maxMs: remainingPipelineMs(),
      coalesceDesktop: false,
    });

    if (!cancelled()) {
      useGatewayStore.setState({
        startupPhase: null,
        lastError: ok ? null : useGatewayStore.getState().lastError,
      });
    }
    return ok;
  };

  try {
    return await withTimeout(run(), outerMaxMs, "startupConnect");
  } catch (e) {
    if (!cancelled()) {
      invalidateConnectPipeline();
      useGatewayStore.setState({
        connState: "error",
        startupPhase: null,
        lastError:
          (() => {
            const msg = e instanceof Error ? e.message : String(e);
            return msg.includes("超时") || msg.includes("timeout")
              ? "连接本机服务超时。请检查安装目录下的内置运行时是否完整，或在「软件设置 → 本机服务」重试。"
              : msg.slice(0, 180);
          })(),
      });
    }
    return false;
  }
}
