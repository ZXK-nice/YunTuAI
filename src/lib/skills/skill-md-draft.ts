import { findIndustry, findRole, type SkillStudioScenario } from "./skill-studio-catalog";
import { renderCustomScenarioSection, renderScenarioPlaybook } from "./skill-scenario-playbooks";

export type SkillStudioDraftInput = {
  industryId: string;
  roleId: string;
  selectedScenarioIds: string[];
  customNotes: string;
  /** 「其他」行业：用户自填 */
  customIndustryLabel?: string;
  customRoleLabel?: string;
  /** 「其他」或补充：自由描述办事场景 */
  customScenarioText?: string;
};

export type SkillStudioDraftResult = {
  dirName: string;
  skillName: string;
  skillMd: string;
  industryLabel: string;
  roleLabel: string;
  scenarios: SkillStudioScenario[];
  source: "local" | "ai";
};

const DIR_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSkillDirName(dirName: string): boolean {
  return DIR_NAME_RE.test(dirName) && dirName.length >= 3 && dirName.length <= 64;
}

function slugifyAscii(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function buildSkillDirSlug(input: SkillStudioDraftInput): string {
  if (input.industryId === "custom") {
    const role = input.customRoleLabel?.trim();
    const slug = role ? slugifyAscii(role) : "";
    if (slug && isValidSkillDirName(`custom-${slug}`)) return `custom-${slug}`;
    return `custom-skill-${Date.now().toString(36)}`;
  }
  const base = `${input.industryId}-${input.roleId}`.toLowerCase();
  if (isValidSkillDirName(base)) return base;
  return `skill-studio-${Date.now().toString(36)}`;
}

function resolveLabels(input: SkillStudioDraftInput): {
  industryLabel: string;
  roleLabel: string;
  industry: ReturnType<typeof findIndustry>;
  role: ReturnType<typeof findRole>;
} | null {
  const industry = findIndustry(input.industryId);
  if (!industry) return null;

  if (industry.custom) {
    const industryLabel = input.customIndustryLabel?.trim() || "其他行业";
    const roleLabel = input.customRoleLabel?.trim() || "自定义岗位";
    if (!input.customRoleLabel?.trim() && !input.customScenarioText?.trim() && !input.customNotes.trim()) {
      return null;
    }
    return {
      industryLabel,
      roleLabel,
      industry,
      role: industry.roles[0],
    };
  }

  const role = findRole(input.industryId, input.roleId);
  if (!role) return null;
  return { industryLabel: industry.label, roleLabel: role.label, industry, role };
}

function collectScenarios(input: SkillStudioDraftInput, role: NonNullable<ReturnType<typeof findRole>>): SkillStudioScenario[] {
  return role.scenarios.filter((s) => input.selectedScenarioIds.includes(s.id));
}

function buildTriggers(
  industryLabel: string,
  roleLabel: string,
  scenarios: SkillStudioScenario[],
  customNotes: string,
  customScenarioText: string,
): string[] {
  const triggers = new Set<string>();
  triggers.add(industryLabel);
  triggers.add(roleLabel);
  triggers.add(`${industryLabel}${roleLabel}`);
  for (const s of scenarios) {
    triggers.add(s.label);
    if (s.summary.length <= 40) triggers.add(s.summary);
  }
  const extra = (customScenarioText || customNotes).trim();
  if (extra) triggers.add(extra.slice(0, 60));
  return [...triggers].filter(Boolean).slice(0, 14);
}

function yamlEscape(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (/[:#{}[\],&*!|>'"%@`]/.test(flat) || flat.length > 120) {
    return `>-\n  ${flat}`;
  }
  return flat;
}

function buildDescription(
  industryLabel: string,
  roleLabel: string,
  scenarios: SkillStudioScenario[],
  input: SkillStudioDraftInput,
): string {
  const scenePart =
    scenarios.length > 0
      ? scenarios.map((s) => s.label).join("、")
      : (input.customScenarioText?.trim() || input.customNotes.trim() || "按用户描述的高频办事场景协助执行");
  return `面向${industryLabel}「${roleLabel}」的办事技能，覆盖：${scenePart}。强调可交付草稿、明确待确认项，不替代专业人士最终判断。`;
}

function buildScenarioSection(
  input: SkillStudioDraftInput,
  industryLabel: string,
  roleLabel: string,
  scenarios: SkillStudioScenario[],
): string {
  if (input.industryId === "custom" || scenarios.length === 0) {
    return renderCustomScenarioSection(
      input.customScenarioText ?? "",
      input.customNotes,
      roleLabel,
      industryLabel,
    );
  }
  return scenarios.map((s) => renderScenarioPlaybook(s, roleLabel, industryLabel)).join("\n\n");
}

function buildWorkflowSection(industryLabel: string, roleLabel: string, isCustom: boolean): string {
  if (isCustom) {
    return `1. **听懂任务**：复述用户目标，确认输出是给谁看、用来做什么。
2. **补齐材料**：缺什么就问什么；不要猜客户名、金额、法条。
3. **按场景执行**：遵循用户描述的工作习惯与格式偏好。
4. **交付可审稿**：给出能直接改的草稿，并列出「请你确认」清单。
5. **收尾动作**：建议下一步是发送、存档还是约会议。`;
  }
  return `1. **对齐上下文**：确认 ${industryLabel} / ${roleLabel} 的具体对象、时间与成功标准。
2. **材料门禁**：没有原件/数据支撑时，先列缺失项，不往下编。
3. **分场景执行**：命中下方某一办事场景时，严格按该场景的步骤与交付物执行。
4. **双轨输出**：对内备忘（可含假设）与对外文稿（不含未确认承诺）分开给。
5. **闭环**：每次结束都提示用户：发送谁、抄送谁、是否需要二次审核。`;
}

export function buildSkillMdDraft(
  input: SkillStudioDraftInput,
  opts?: { skillMdOverride?: string; source?: "local" | "ai" },
): SkillStudioDraftResult | null {
  const resolved = resolveLabels(input);
  if (!resolved) return null;
  const { industryLabel, roleLabel, industry, role } = resolved;
  if (!industry) return null;
  if (!industry.custom && !role) return null;

  const scenarios = industry.custom || !role ? [] : collectScenarios(input, role);
  const dirName = buildSkillDirSlug(input);
  const skillName = dirName;
  const description = buildDescription(industryLabel, roleLabel, scenarios, input);
  const triggers = buildTriggers(
    industryLabel,
    roleLabel,
    scenarios,
    input.customNotes,
    input.customScenarioText ?? "",
  );
  const triggerYaml = triggers.map((t) => `  - ${JSON.stringify(t)}`).join("\n");
  const scenarioSection = buildScenarioSection(input, industryLabel, roleLabel, scenarios);
  const workflow = buildWorkflowSection(industryLabel, roleLabel, Boolean(industry.custom));

  const notesRaw = input.customNotes.trim();
  const discoveryBlock = notesRaw.includes("【沟通澄清】")
    ? notesRaw.split("【沟通澄清】")[1]?.trim()
    : "";
  const extraNotes = notesRaw.includes("【沟通澄清】")
    ? notesRaw.split("【沟通澄清】")[0]?.trim()
    : notesRaw;

  const skillMd =
    opts?.skillMdOverride?.trim() ||
    `---
name: ${skillName}
description: ${yamlEscape(description)}
metadata:
  openclaw:
    always: true
triggers:
${triggerYaml}
---

# ${industryLabel} · ${roleLabel}

你是熟悉 **${industryLabel} / ${roleLabel}** 日常工作的办事助手。用户会用口语描述任务；你的目标是产出**可直接改稿使用**的内容，而不是空泛建议。

## 自动启用（重要）

本技能安装后**默认自动生效**。只要任务与下方场景相关，直接按本文件执行，**不要**要求用户提醒或「启用技能」。

## 何时启用本技能

${triggers.map((t) => `- ${t}`).join("\n")}

## 工作方式

${workflow}

## 办事场景 playbook

${scenarioSection}

${
  discoveryBlock
    ? `## 与用户沟通确认（生成前已收集）\n\n以下信息来自技能工坊访谈，执行时优先遵循：\n\n${discoveryBlock}\n`
    : ""
}${
  extraNotes
    ? `## 用户补充偏好\n\n${extraNotes}\n`
    : ""
}
## 边界（必须遵守）

- 法律、医疗、审计、税务等**结论性意见**只能做材料整理与风险提示，不能替用户拍板。
- 未提供的数字、日期、客户名称、折扣与交付承诺**一律标注待确认**，禁止虚构。
- 处理个人信息与商业机密时默认脱敏；对外发送前提醒用户复核。

## 输出习惯

- 先给结论或可直接使用的正文，再给备选表述。
- 需要表格时用 Markdown 表格；需要邮件时给主题行 + 正文。
- 末尾附 **「请你确认」** 3 条以内清单。`;

  return {
    dirName,
    skillName,
    skillMd: ensureOpenClawAlwaysMetadata(skillMd),
    industryLabel,
    roleLabel,
    scenarios,
    source: opts?.source ?? "local",
  };
}

/** 确保 frontmatter 含 metadata.openclaw.always，安装后进入默认技能目录。 */
export function ensureOpenClawAlwaysMetadata(skillMd: string): string {
  const trimmed = skillMd.trim();
  if (/metadata:[\s\S]*?openclaw:[\s\S]*?always:\s*true/.test(trimmed)) {
    return trimmed;
  }
  if (!trimmed.startsWith("---")) {
    return `---\nmetadata:\n  openclaw:\n    always: true\n---\n\n${trimmed}`;
  }
  const end = trimmed.indexOf("\n---", 3);
  if (end < 0) {
    return `---\nmetadata:\n  openclaw:\n    always: true\n---\n\n${trimmed}`;
  }
  let yaml = trimmed.slice(3, end).replace(/^\n/, "");
  const body = trimmed.slice(end + 4);
  if (!/metadata:/.test(yaml)) {
    yaml = `${yaml.trimEnd()}\nmetadata:\n  openclaw:\n    always: true`;
  } else if (!/openclaw:/.test(yaml)) {
    yaml = `${yaml.trimEnd()}\n  openclaw:\n    always: true`;
  } else if (!/always:\s*true/.test(yaml)) {
    yaml = `${yaml.trimEnd()}\n    always: true`;
  }
  return `---\n${yaml.trimEnd()}\n---${body}`;
}

/** 从模型回复中提取 SKILL.md 正文 */
export function extractSkillMdFromAiResponse(text: string): string | null {
  const fenced = text.match(/```(?:markdown|md)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.includes("name:") && fenced[1].includes("---")) {
    return fenced[1].trim();
  }
  if (text.trim().startsWith("---") && text.includes("name:")) {
    return text.trim();
  }
  return null;
}
