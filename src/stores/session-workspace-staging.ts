import { getGatewayClient } from "../lib/openclaw/gateway-runtime";
import {
  OPENCLAW_STAGING_USER_FILENAME,
  assertMergedUserMdWithinLimit,
  buildUserMdStagingSection,
  extractAgentsFilesGetContent,
  prependStagingToUserMd,
} from "../lib/openclaw/openclaw-user-md-staging";
import { resolveDefaultAgentId } from "../lib/openclaw/resolve-default-agent";

export type WorkspaceTextFile = { displayName: string; content: string };

export type StageWorkspaceResult =
  | { ok: true; batchId: string }
  | { ok: false; error: string };

/** 将文本类附件合并写入 agent USER.md 预置区（从 sessionStore 拆出）。 */
export async function stageWorkspaceTextFiles(opts: {
  workspaceTextFiles: WorkspaceTextFile[];
  workspaceBatchId?: string;
  sessionAgentId?: string;
}): Promise<StageWorkspaceResult> {
  const client = getGatewayClient();
  const sessionAgentId = opts.sessionAgentId?.trim();
  const resolvedAgentId =
    sessionAgentId || (await resolveDefaultAgentId((m, p) => client.request(m, p)));
  const agentId = resolvedAgentId?.trim();
  if (!agentId) {
    return {
      ok: false,
      error:
        "无法解析默认 agent，不能写入工作区。请在本机服务中配置 agents.list（含默认 agent）后重试。",
    };
  }
  try {
    const getRaw = await client.request("agents.files.get", {
      agentId,
      name: OPENCLAW_STAGING_USER_FILENAME,
    });
    const existing = extractAgentsFilesGetContent(getRaw);
    const batchId =
      opts.workspaceBatchId?.trim() ||
      crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const staging = buildUserMdStagingSection(
      batchId,
      opts.workspaceTextFiles.map((f) => ({
        displayName: f.displayName,
        content: f.content,
        workspaceRelPath: `workspace/inbox/${batchId}/${f.displayName.replace(/[/\\]/g, "_")}`,
      })),
    );
    const merged = prependStagingToUserMd(existing, staging);
    assertMergedUserMdWithinLimit(merged);
    await client.request("agents.files.set", {
      agentId,
      name: OPENCLAW_STAGING_USER_FILENAME,
      content: merged,
    });
    return { ok: true, batchId };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `写入工作区失败：${raw}` };
  }
}
