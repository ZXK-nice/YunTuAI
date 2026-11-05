import { APP_VERSION } from "./app-version";
import { invokeAuthed } from "./tauri-invoke";
import { getUpdateManifestUrl, type UpdateCheckResult } from "./update-config";
import { isTauriRuntime } from "./tauri-env";

export async function checkForAppUpdate(
  manifestUrl = getUpdateManifestUrl(),
): Promise<UpdateCheckResult | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<UpdateCheckResult>("app_check_update", {
    manifestUrl,
    currentVersion: APP_VERSION,
  }, { timeoutMs: 20_000 });
}

export async function installMsiUpdate(input: {
  downloadUrl: string;
  sha256: string;
  versionLabel?: string;
}): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("仅桌面版支持 MSI 更新");
  }
  await invokeAuthed<void>(
    "app_install_msi_update",
    {
      downloadUrl: input.downloadUrl,
      expectedSha256: input.sha256,
      versionLabel: input.versionLabel ?? null,
    },
    { timeoutMs: 720_000 },
  );
}

/** 上次 MSI 升级若失败，返回一次性提示（读后即删）。 */
export async function consumeUpdateFailureHint(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<string | null>("app_consume_update_failure_hint");
}
