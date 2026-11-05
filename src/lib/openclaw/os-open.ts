import { invokeWithAuthRetry } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

/** 使用系统文件管理器打开路径（目录或文件）。走 Rust 命令，避免 Tauri opener 路径权限限制。 */
export async function revealPathInOs(path: string): Promise<void> {
  if (!isTauriRuntime() || !path.trim()) return;
  await invokeWithAuthRetry<void>("reveal_path_in_os_cmd", { path: path.trim() });
}
