import { invokeAuthed } from "../tauri-invoke";

/** 从磁盘 openclaw.json 读取的 MCP 服务器条目 */
export type McpServerFromConfig = {
  name: string;
  description?: string;
  command?: string;
  args?: string[];
  enabled: boolean;
  toolCount: number;
};

/**
 * 调用 Tauri IPC 读取 openclaw.json 中的 MCP 服务器配置。
 * 返回 []（而非 null）表示无 MCP 或文件不存在。
 */
export async function readMcpServersFromConfig(): Promise<McpServerFromConfig[]> {
  try {
    const result = await invokeAuthed<McpServerFromConfig[]>(
      "openclaw_read_mcp_servers",
    );
    return result ?? [];
  } catch {
    return [];
  }
}
