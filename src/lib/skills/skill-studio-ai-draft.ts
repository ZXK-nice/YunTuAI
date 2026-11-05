import { getGatewayClient } from "../openclaw/gateway-runtime";
import {
  buildSkillMdDraft,
  extractSkillMdFromAiResponse,
  type SkillStudioDraftInput,
  type SkillStudioDraftResult,
} from "./skill-md-draft";
import {
  ensureSkillStudioEphemeralSession,
  sendSkillStudioPromptAndPoll,
} from "./skill-studio-session";

function buildAiGenerationPrompt(input: SkillStudioDraftInput, localDraft: SkillStudioDraftResult): string {
  const scenarioLines =
    localDraft.scenarios.length > 0
      ? localDraft.scenarios.map((s) => `- ${s.label}：${s.summary}`).join("\n")
      : `- ${input.customScenarioText?.trim() || input.customNotes.trim() || "用户将以对话补充"}`;

  return `你是资深 YunTuAI Agent Skill 作者。请为真实岗位写一份**专业、贴身、非模板化**的 SKILL.md。

## 用户信息
- 行业：${localDraft.industryLabel}
- 岗位：${localDraft.roleLabel}
- 建议目录名：\`${localDraft.dirName}\`

## 办事场景
${scenarioLines}

${input.customNotes.trim() ? `## 补充偏好与沟通记录\n${input.customNotes.trim()}\n` : ""}
## 本地草稿（可改写，不要原样复读八股结构）
\`\`\`markdown
${localDraft.skillMd.slice(0, 6000)}
\`\`\`

## 写作要求
1. 输出**完整** SKILL.md，含 YAML frontmatter（name、description、triggers，以及 metadata.openclaw.always: true）。
2. triggers 含中文口语触发词，贴近该岗位真实说法。
3. 每个办事场景要有**具体步骤、交付物、追问清单**，避免「确认需求→执行任务→输出结果」式空话。
4. 体现 ${localDraft.industryLabel} / ${localDraft.roleLabel} 的工作语境，可引用常见工具/文档类型但不编造公司名。
5. 写清边界：哪些不能替用户决定。
6. 明确写：安装后自动生效，无需用户提醒启用。
7. 只输出一份 Markdown，放入 \`\`\`markdown 代码块，不要额外解释。`;
}

/** 网关在线时调用模型生成更专业的 SKILL.md；失败则返回本地草稿。使用隔离会话，不污染主聊天。 */
export async function generateSkillDraft(
  input: SkillStudioDraftInput,
  options?: { signal?: AbortSignal; preferAi?: boolean },
): Promise<SkillStudioDraftResult | null> {
  const local = buildSkillMdDraft(input, { source: "local" });
  if (!local) return null;
  if (options?.preferAi === false) return local;

  const client = getGatewayClient();
  if (!client.isHelloOk) return local;

  const sessionKey = await ensureSkillStudioEphemeralSession();
  if (!sessionKey) return local;

  const prompt = buildAiGenerationPrompt(input, local);

  try {
    const reply = await sendSkillStudioPromptAndPoll(sessionKey, prompt, {
      signal: options?.signal,
      timeoutMs: 120_000,
    });

    if (!reply) return local;

    const extracted = extractSkillMdFromAiResponse(reply);
    if (!extracted) return local;

    return (
      buildSkillMdDraft(input, { skillMdOverride: extracted, source: "ai" }) ?? {
        ...local,
        skillMd: extracted,
        source: "ai" as const,
      }
    );
  } catch {
    return local;
  }
}
