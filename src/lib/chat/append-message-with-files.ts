import { isWithinLocalMessageLimit } from "../db-limits";
import { isTauriRuntime } from "../tauri-env";
import { invokeWithAuthRetry } from "../tauri-invoke";
import { chatScanNewOutputFiles } from "./chat-files-bridge";
import { encodeMessageDisplayContentV2 } from "./message-files";
import type { LocalMessageRow } from "../../stores/sessionStore";

/** 写入助手消息，并附带自 sinceMs 以来产出目录中的新文件。
 *  @param thinking 助手思考过程文本（可为空，用于折叠展示） */
export async function appendAssistantMessageWithFiles(
  sessionId: string,
  content: string,
  sinceMs?: number,
  thinking?: string,
): Promise<LocalMessageRow | null> {
  if (!isTauriRuntime()) return null;
  if (!isWithinLocalMessageLimit(content)) return null;

  let displayContent: string | undefined;
  if (sinceMs != null && sinceMs > 0) {
    const scanned = await chatScanNewOutputFiles(sinceMs);
    if (scanned?.length || thinking?.trim()) {
      displayContent =
        scanned?.length
          ? encodeMessageDisplayContentV2(content, thinking, scanned)
          : encodeMessageDisplayContentV2(content, thinking, []);
    }
  } else if (thinking?.trim()) {
    displayContent = encodeMessageDisplayContentV2(content, thinking, []);
  }

  return invokeWithAuthRetry<LocalMessageRow>("db_append_message", {
    sessionId,
    role: "assistant",
    content,
    displayContent: displayContent ?? null,
  });
}

/** 写入用户消息，可选附件展示元数据。 */
export async function appendUserMessageWithFiles(
  sessionId: string,
  content: string,
  displayContent?: string | null,
): Promise<LocalMessageRow> {
  return invokeWithAuthRetry<LocalMessageRow>("db_append_message", {
    sessionId,
    role: "user",
    content,
    displayContent: displayContent ?? null,
  });
}
