import { invoke } from "@tauri-apps/api/core";
import { getAuthToken, useAuthStore, type UserInfo } from "../stores/authStore";
import { getEncryptedItem, setEncryptedItem } from "./safeStorage";
import { triggerForceLogout } from "./force-logout-handler";
import { withTimeout } from "./async-utils";

const TOKEN_KEY = "yuntuai_auth_token";
/** 所有 Tauri IPC 默认超时，避免后端阻塞时拖死 WebView 主线程 */
const DEFAULT_INVOKE_TIMEOUT_MS = 10_000;

export function readPersistedAuthToken(): string | null {
  try {
    const t = getEncryptedItem(TOKEN_KEY)?.trim();
    return t || null;
  } catch {
    return null;
  }
}

/** 数据库 / 审计 RPC 所需的已登录 token；优先内存，其次 localStorage。 */
export function requireAuthToken(): string {
  const fromMemory = getAuthToken()?.trim();
  if (fromMemory) return fromMemory;
  const fromDisk = readPersistedAuthToken();
  if (fromDisk) return fromDisk;
  throw new Error("未登录");
}

export function isAuthSessionError(message: string): boolean {
  return /会话无效|会话已过期|未登录/.test(message);
}

/** 用磁盘 token 恢复登录态，并写回最新加密 token。 */
export async function refreshAuthSession(): Promise<string> {
  const saved = readPersistedAuthToken();
  if (!saved) {
    throw new Error("未登录");
  }
  const user = await invoke<UserInfo>("auth_resume_session", { token: saved });
  setEncryptedItem(TOKEN_KEY, user.token);
  useAuthStore.setState({
    user,
    isLoggedIn: true,
    hasAnyUsers: true,
    initError: null,
  });
  return user.token;
}

type InvokeOptions = {
  /** 关键操作：session 无效时强制登出（默认 true）。非关键操作设为 false 则仅抛错。 */
  critical?: boolean;
  /** IPC 超时毫秒（默认 10s） */
  timeoutMs?: number;
};

/** 鉴权失败时自动 resume 并重试一次；仍失败则根据 critical 决定行为。 */
export async function invokeWithAuthRetry<T>(
  cmd: string,
  args: Record<string, unknown>,
  options?: InvokeOptions,
): Promise<T> {
  const critical = options?.critical ?? true;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;
  const run = (token: string) =>
    withTimeout(invoke<T>(cmd, { ...args, token }), timeoutMs, cmd);

  try {
    return await run(requireAuthToken());
  } catch (first) {
    const msg = first instanceof Error ? first.message : String(first);
    if (!isAuthSessionError(msg)) {
      throw first;
    }
    if (!critical) {
      throw first;
    }
    try {
      const token = await withTimeout(refreshAuthSession(), timeoutMs, "auth_resume_session");
      return await run(token);
    } catch (second) {
      triggerForceLogout("您的会话已过期，请重新登录。");
      throw second;
    }
  }
}
