import { invokeWithAuthRetry } from "./auth-token";
import { t } from "./i18n";
import { isTauriRuntime } from "./tauri-env";

export {
  invokeWithAuthRetry,
  isAuthSessionError,
  readPersistedAuthToken,
  refreshAuthSession,
  requireAuthToken,
} from "./auth-token";

export class DesktopOnlyError extends Error {
  constructor(message = t("auth.desktop_only")) {
    super(message);
    this.name = "DesktopOnlyError";
  }
}

export function isDesktopOnlyError(err: unknown): boolean {
  return err instanceof DesktopOnlyError;
}

/** 携带登录 token 的 Tauri invoke；浏览器预览模式抛出 DesktopOnlyError。 */
export async function invokeAuthed<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  options?: { critical?: boolean; timeoutMs?: number },
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new DesktopOnlyError();
  }
  return invokeWithAuthRetry<T>(cmd, args, options);
}
