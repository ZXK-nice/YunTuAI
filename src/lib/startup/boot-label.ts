import type { ProvisionSnapshot } from "../openclaw/provision-bridge";

/** 合并多段 Boot 文案，减少「换屏但仍转圈」的割裂感。 */
export function resolveEarlyBootLabel(opts: {
  authReady: boolean;
  licenseReady: boolean;
  provisionChecking: boolean;
  provisionSnapshot: ProvisionSnapshot | null;
  envCheckPending?: boolean;
}): string {
  const snapMsg = opts.provisionSnapshot?.message?.trim();
  if (snapMsg) return snapMsg;
  if (opts.envCheckPending) return "正在检查模型配置…";
  if (!opts.authReady || !opts.licenseReady) return "正在初始化账号与授权…";
  if (opts.provisionChecking) return "正在准备本机环境…";
  return "正在启动…";
}
