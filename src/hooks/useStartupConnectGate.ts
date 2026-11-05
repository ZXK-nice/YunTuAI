import { useFirstRunGatewayGate } from "./useFirstRunGatewayGate";
import { usePostLoginConnectGate } from "./usePostLoginConnectGate";
import type { ProvisionSnapshot } from "../lib/openclaw/provision-bridge";

export type StartupConnectGate = {
  /** 是否显示统一连接/准备屏（首启或日常连接门） */
  active: boolean;
  mode: "provision" | "connect";
  label: string;
  error: string | null;
  onRetry: () => void;
  provisionSnapshot: ProvisionSnapshot | null;
  canEnterOffline: boolean;
  onEnterOffline: () => void;
  /** 已选离线进入：主界面可在未连接时保留 */
  allowOfflineMain: boolean;
};

/**
 * 合并首启网关引导与登录后连接门闸，App 只渲染一块 ServiceReadinessScreen。
 */
export function useStartupConnectGate(
  postLoginReady: boolean,
  opts?: { provisionRetry?: () => void },
): StartupConnectGate {
  const provisionRetry = opts?.provisionRetry ?? (() => undefined);
  const firstRun = useFirstRunGatewayGate(postLoginReady);
  const postLogin = usePostLoginConnectGate(postLoginReady && !firstRun.active);

  if (firstRun.active && !firstRun.passed) {
    if (firstRun.showProvision && firstRun.snapshot) {
      return {
        active: true,
        mode: "provision",
        label: firstRun.connectLabel,
        error: firstRun.snapshot.error ?? null,
        onRetry: provisionRetry,
        provisionSnapshot: firstRun.snapshot,
        canEnterOffline: firstRun.canEnterOffline,
        onEnterOffline: firstRun.enterOffline,
        allowOfflineMain: firstRun.allowOfflineMain,
      };
    }
    return {
      active: true,
      mode: "connect",
      label: firstRun.connectLabel,
      error: firstRun.connectError,
      onRetry: firstRun.retryConnect,
      provisionSnapshot: null,
      canEnterOffline: firstRun.canEnterOffline,
      onEnterOffline: firstRun.enterOffline,
      allowOfflineMain: firstRun.allowOfflineMain,
    };
  }

  if (postLogin.gated) {
    return {
      active: true,
      mode: "connect",
      label: postLogin.label,
      error: postLogin.error,
      onRetry: postLogin.retry,
      provisionSnapshot: null,
      canEnterOffline: postLogin.canEscape,
      onEnterOffline: postLogin.enterOffline,
      allowOfflineMain: postLogin.allowOfflineMain,
    };
  }

  return {
    active: false,
    mode: "connect",
    label: "",
    error: null,
    onRetry: () => undefined,
    provisionSnapshot: null,
    canEnterOffline: false,
    onEnterOffline: () => undefined,
    allowOfflineMain: firstRun.allowOfflineMain || postLogin.allowOfflineMain,
  };
}
