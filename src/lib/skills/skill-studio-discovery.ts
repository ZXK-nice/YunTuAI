import { findIndustry, findRole, type SkillStudioScenario } from "./skill-studio-catalog";
import type { SkillStudioDraftInput } from "./skill-md-draft";

export type DiscoveryQuestion = {
  id: string;
  question: string;
  hint?: string;
  placeholder?: string;
  optional?: boolean;
};

export type DiscoveryContext = {
  industryId: string;
  roleId: string;
  industryLabel: string;
  roleLabel: string;
  scenarios: SkillStudioScenario[];
  isCustom: boolean;
};

export function resolveDiscoveryContext(input: SkillStudioDraftInput): DiscoveryContext | null {
  const industry = findIndustry(input.industryId);
  if (!industry) return null;

  if (industry.custom) {
    return {
      industryId: input.industryId,
      roleId: input.roleId,
      industryLabel: input.customIndustryLabel?.trim() || "其他行业",
      roleLabel: input.customRoleLabel?.trim() || "自定义岗位",
      scenarios: [],
      isCustom: true,
    };
  }

  const role = findRole(input.industryId, input.roleId);
  if (!role) return null;
  const scenarios = role.scenarios.filter((s) => input.selectedScenarioIds.includes(s.id));

  return {
    industryId: input.industryId,
    roleId: input.roleId,
    industryLabel: industry.label,
    roleLabel: role.label,
    scenarios,
    isCustom: false,
  };
}

const UNIVERSAL: DiscoveryQuestion[] = [
  {
    id: "daily-pain",
    question: "你每天/每周重复最烦、最耗时的办事是哪几件？",
    hint: "越具体越好，例如「每周五汇总 20 个销售的回款表」",
    placeholder: "例如：早上先看昨日询盘，下午写报价和跟进邮件…",
  },
  {
    id: "output-style",
    question: "你希望 AI 的输出更像什么？",
    hint: "决定语气、长度和格式",
    placeholder: "例如：对外邮件要正式英文；对内用口语微信；表格优先…",
  },
  {
    id: "must-not",
    question: "有哪些事 AI 绝不能替你做决定或绝不能乱编？",
    hint: "例如价格、交期、法律结论、客户真名",
    placeholder: "例如：不能代我承诺折扣；金额必须我确认；不要编造客户名…",
  },
];

const BY_INDUSTRY: Record<string, DiscoveryQuestion[]> = {
  sales: [
    {
      id: "sales-customer",
      question: "你主要卖给谁？卖什么？",
      placeholder: "例如：华东制造业中小企业，卖 MES 模块；或门店零售 3C…",
    },
    {
      id: "sales-channel",
      question: "常用沟通渠道和工具是什么？",
      placeholder: "例如：企业微信 + 电话；用纷享销客 CRM；报价用 Excel 模板…",
      optional: true,
    },
  ],
  "foreign-trade": [
    {
      id: "trade-market",
      question: "主要市场与常用语言？",
      placeholder: "例如：欧美英语为主，偶尔西语；FOB 深圳港…",
    },
    {
      id: "trade-docs",
      question: "最常处理的单证或系统？",
      placeholder: "例如：报关单、PI、信用证；用某货代平台…",
      optional: true,
    },
  ],
  "smart-manufacturing": [
    {
      id: "mfg-line",
      question: "你负责的产品线/车间/工序范围？",
      placeholder: "例如：SMT 二线；注塑车间；全厂质量…",
    },
  ],
  "finance-tax": [
    {
      id: "finance-scope",
      question: "你负责的核算范围或主体？",
      placeholder: "例如：集团合并报表；单一工厂应收；增值税申报…",
    },
  ],
  "software-rd": [
    {
      id: "rd-stack",
      question: "团队技术栈与协作工具？",
      placeholder: "例如：React + Tauri；Jira + Confluence；GitHub PR 流程…",
      optional: true,
    },
  ],
  custom: [
    {
      id: "custom-context",
      question: "用一段话介绍你的工作环境和同事怎么找到你帮忙",
      placeholder: "例如：我是连锁餐饮区域督导，门店店长会在群里 @ 我要活动方案…",
    },
  ],
};

const BY_ROLE: Record<string, DiscoveryQuestion> = {
  "inside-sales": {
    id: "role-call",
    question: "一通电话或一次跟进，怎样算「做好了」？",
    placeholder: "例如：要到微信、约到演示、或确认预算范围…",
    optional: true,
  },
  "b2b-enterprise": {
    id: "role-deal",
    question: "你手里典型一单从线索到签约要多久？卡在哪？",
    placeholder: "例如：平均 3 个月，卡在技术评估和招标…",
    optional: true,
  },
  "document-specialist": {
    id: "role-doc",
    question: "哪类单证最容易出错？你们怎么复核？",
    optional: true,
    placeholder: "例如：HS 编码与品名；双人交叉核对…",
  },
};

function scenarioQuestion(scenarios: SkillStudioScenario[]): DiscoveryQuestion | null {
  if (scenarios.length === 0) return null;
  const labels = scenarios.map((s) => s.label).join("、");
  return {
    id: "scenario-focus",
    question: `你选了「${labels}」，平时哪一件最急、最想先让 AI 帮好？`,
    hint: "我们会把这一块写得更细",
    placeholder: "例如：询盘回复要 2 小时内出英文初稿；或报价必须带 MOQ…",
  };
}

/** 根据行业/岗位/场景生成 4–6 个沟通问题（离线可用） */
export function buildDiscoveryQuestions(ctx: DiscoveryContext): DiscoveryQuestion[] {
  const out: DiscoveryQuestion[] = [];
  const seen = new Set<string>();

  const push = (q: DiscoveryQuestion) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q);
  };

  if (ctx.isCustom) {
    for (const q of BY_INDUSTRY.custom ?? []) push(q);
  } else {
    for (const q of BY_INDUSTRY[ctx.industryId] ?? []) push(q);
    const roleQ = BY_ROLE[ctx.roleId];
    if (roleQ) push(roleQ);
    const sq = scenarioQuestion(ctx.scenarios);
    if (sq) push(sq);
  }

  for (const q of UNIVERSAL) push(q);

  return out.slice(0, 7);
}

export function formatDiscoveryBrief(
  questions: DiscoveryQuestion[],
  answers: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const q of questions) {
    const a = answers[q.id]?.trim();
    if (!a) continue;
    lines.push(`**${q.question}**\n${a}`);
  }
  return lines.join("\n\n");
}

export function countAnsweredRequired(
  questions: DiscoveryQuestion[],
  answers: Record<string, string>,
): { required: number; answered: number; totalChars: number } {
  let required = 0;
  let totalChars = 0;
  for (const q of questions) {
    if (!q.optional) required += 1;
    const a = answers[q.id]?.trim() ?? "";
    totalChars += a.length;
  }
  const requiredAnswered = questions.filter((q) => !q.optional && (answers[q.id]?.trim() ?? "").length > 0).length;
  return { required, answered: requiredAnswered, totalChars };
}

export function isDiscoverySufficient(
  questions: DiscoveryQuestion[],
  answers: Record<string, string>,
): boolean {
  const { required, answered, totalChars } = countAnsweredRequired(questions, answers);
  if (answered >= Math.min(required, 2)) return true;
  return totalChars >= 80;
}

export function mergeDiscoveryIntoInput(
  input: SkillStudioDraftInput,
  brief: string,
): SkillStudioDraftInput {
  if (!brief.trim()) return input;
  const block = `【沟通澄清】\n${brief.trim()}`;
  const notes = input.customNotes.trim();
  return {
    ...input,
    customNotes: notes ? `${notes}\n\n${block}` : block,
  };
}

/** 解析 AI 返回的追问 JSON */
export function parseAiFollowUpQuestions(raw: string): DiscoveryQuestion[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]) as unknown[];
    if (!Array.isArray(arr)) return [];
    const out: DiscoveryQuestion[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const question = String(o.question ?? o.q ?? "").trim();
      if (!question) continue;
      out.push({
        id: `ai-fu-${i}-${Date.now().toString(36)}`,
        question,
        placeholder: typeof o.placeholder === "string" ? o.placeholder : undefined,
        hint: typeof o.hint === "string" ? o.hint : "根据你刚才的回答，想再确认一点",
        optional: true,
      });
    }
    return out.slice(0, 3);
  } catch {
    return [];
  }
}
