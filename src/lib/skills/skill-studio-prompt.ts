import type { SkillStudioDraftResult } from "./skill-md-draft";

export function buildSkillRefinementPrompt(
  draft: SkillStudioDraftResult,
  customNotes: string,
  customScenarioText?: string,
): string {
  const scenarioLines =
    draft.scenarios.length > 0
      ? draft.scenarios.map((s) => `- ${s.label}：${s.summary}`).join("\n")
      : "- （用户未选预制场景，请根据补充说明推断）";

  return `请帮我完善一份可安装的 YunTuAI Agent Skill（SKILL.md）。

## 背景
- 行业：${draft.industryLabel}
- 岗位：${draft.roleLabel}
- 目标目录名：\`${draft.dirName}\`

## 用户选择的办事场景
${scenarioLines}

${customScenarioText?.trim() ? `## 用户自定义场景描述\n${customScenarioText.trim()}\n` : ""}
${customNotes.trim() ? `## 用户补充说明\n${customNotes.trim()}\n` : ""}
## 当前草稿（请在此基础上改写，不要从零忽略已有结构）

\`\`\`markdown
${draft.skillMd}
\`\`\`

## 你的任务
1. 按 Agent Skill 规范（含 Cursor Agent Skill 兼容 frontmatter）输出**完整**的 \`SKILL.md\`。
2. frontmatter 必须包含 \`name\`、\`description\`，并补充合理的 \`triggers\` 列表（中英文触发词）。
3. 正文需包含：何时使用、分步工作流程、各场景的详细操作指引、输出格式、禁忌与边界。
4. 语言以中文为主，专业术语可保留英文；面向非开发者，避免过多代码细节。
5. 不要捏造用户未提供的公司名、法条、金额；不确定处用「待用户确认」标注。
6. 只输出一份可直接保存为 \`SKILL.md\` 的 Markdown，不要额外解释。

完善后我会将结果安装到本机 \`workspace/.agents/skills/${draft.dirName}/SKILL.md\`。`;
}

/** 跳转到对话做更深入的技能共创访谈 */
export function buildDiscoveryChatPrompt(
  industryLabel: string,
  roleLabel: string,
  discoveryBrief: string,
  scenarioSummary: string,
): string {
  return `我想在技能工坊里共创一份专属 SKILL.md，请先**访谈我**再动笔，不要立刻生成技能文件。

## 我的身份
- 行业：${industryLabel}
- 岗位：${roleLabel}

## 办事场景
${scenarioSummary || "（我会在对话里补充）"}

## 我已经在工坊里回答过的
${discoveryBrief || "（尚未填写，请从基础问题问起）"}

## 请你这样做
1. 先问我 3–5 个有针对性的问题（一次问 2 个以内，等我回答再继续）。
2. 关注：日常重复工作、输出格式偏好、绝不能犯的错误、常用工具与模板。
3. 我觉得信息够了之后，再输出完整 SKILL.md（含 frontmatter），放入 markdown 代码块。
4. 技能要贴身、可执行，不要空话模板。`;
}
