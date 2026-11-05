import type { ProvisionSnapshot } from "../openclaw/provision-bridge";

/** App 首屏阶段：减少换屏，准备与连接合并为 preparing。 */
export type StartupShellPhase =
  | "preparing"
  | "license"
  | "login"
  | "api_key"
  | "main";

export function resolveStartupShellPhase(input: {
  ready: boolean;
  licenseReady: boolean;
  licensed: boolean;
  isLoggedIn: boolean;
  envSetupReady: boolean;
  envCheckPending: boolean;
  envBlocking: boolean;
  apiKeyErrorFromGate: boolean;
  hasEnvStatus: boolean;
  /** 登录后连接门是否仍激活（未连上网关） */
  startupConnectActive: boolean;
  /** 用户已点「先进入界面」或已进入过主界面：断线时不要整页踢回准备屏 */
  allowOfflineMain?: boolean;
  /** Tauri 下必须 connected 才进主界面 */
  connConnected: boolean;
  isTauri: boolean;
}): StartupShellPhase {
  if (!input.ready || !input.licenseReady) return "preparing";
  if (!input.licensed) return "license";
  if (!input.isLoggedIn) return "login";
  if (!input.envSetupReady || input.envCheckPending) return "preparing";
  if ((input.envBlocking || input.apiKeyErrorFromGate) && input.hasEnvStatus) return "api_key";
  if (input.allowOfflineMain) return "main";
  // 本轮尚未连上时停在加载页。已进过主界面或用户选择离线进入后，断线不再整页踢回。
  if (input.startupConnectActive) return "preparing";
  return "main";
}

export function resolvePreparingDetail(opts: {
  authReady: boolean;
  licenseReady: boolean;
  provisionChecking: boolean;
  provisionSnapshot: ProvisionSnapshot | null;
  envCheckPending?: boolean;
  envSetupReady?: boolean;
  connectLabel?: string | null;
}): string {
  const snapMsg = opts.provisionSnapshot?.message?.trim();
  if (snapMsg) return snapMsg;
  if (opts.connectLabel?.trim()) return opts.connectLabel.trim();
  if (opts.envCheckPending || !opts.envSetupReady) return "正在检查模型配置…";
  if (!opts.authReady || !opts.licenseReady) return "正在初始化账号与授权…";
  if (opts.provisionChecking) return "正在准备本机环境…";
  return "正在启动…";
}
