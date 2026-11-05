import type { SkillStudioScenario } from "./skill-studio-catalog";

type Playbook = {
  askFirst: string[];
  steps: string[];
  deliverables: string[];
  cautions: string[];
};

const SALES_PLAYBOOKS: Record<string, Partial<Playbook>> = {
  "cold-call-script": {
    askFirst: ["目标客户职位与行业", "上次触达记录", "本轮目标：约访 / 确认需求 / 推进试用"],
    steps: [
      "用 15 秒自我介绍：公司 + 价值点 + 不占用太久",
      "抛出与客户行业相关的痛点问题，确认是否共鸣",
      "给出一个具体收益例子（用区间或案例，不编造客户名）",
      "收口：约 15 分钟电话或发送一页资料",
    ],
    deliverables: ["完整电话脚本（开场/探需/异议/收口）", "若未接通的语音留言 20 秒版"],
    cautions: ["避免未核实就承诺价格、折扣或交付日期"],
  },
  "objection-price": {
    askFirst: ["客户比价对象", "预算范围是否已知", "最看重的价值维度"],
    steps: [
      "复述客户顾虑，确认是总价、单价还是付款方式问题",
      "把对话从价格拉回价值：TCO、风险、时间成本",
      "提供 2 种可选方案（标准 / 精简），不主动大幅降价",
      "需要审批的折扣明确标注「待内部确认」",
    ],
    deliverables: ["异议应答话术", "可选方案对比表（Markdown）"],
    cautions: ["不得虚构竞品缺陷或未经授权的案例数据"],
  },
  "account-plan": {
    askFirst: ["账户历史采购与合同状态", "已知决策人与影响人", "本季度营收目标"],
    steps: [
      "绘制组织关系：决策 / 影响 / 使用 / 采购",
      "列出客户业务目标与我们方案的映射",
      "标注竞品动向与替换风险",
      "排期：本月必赢动作与关键会议",
    ],
    deliverables: ["客户作战地图（表格）", "下一步 3 个可执行动作"],
    cautions: ["涉密信息仅基于用户提供的材料"],
  },
};

const GENERIC_ASK: string[] = [
  "这件事的截止时间与紧急程度",
  "手头已有的材料（邮件、表格、合同、截图）",
  "期望输出格式：直接可发 / 需内部审核 / 仅要点",
  "有没有公司模板、口径或禁用词",
];

function inferDeliverables(label: string, summary: string): string[] {
  const text = `${label} ${summary}`;
  if (/邮件|跟进|回复|催/.test(text)) return ["可直接发送的邮件/消息草稿", "需用户补全的空位清单"];
  if (/清单|核对|检查/.test(text)) return ["勾选式检查表", "差异项与建议动作"];
  if (/报告|复盘|简报|总结/.test(text)) return ["结构化报告大纲或正文", "关键数据待填位标注"];
  if (/话术|脚本|口播/.test(text)) return ["分场景话术", "30 秒电梯版 + 完整版"];
  if (/方案|报价|投标/.test(text)) return ["方案章节结构", "价值点与假设前提"];
  return ["贴合场景的主交付草稿", "人工复核提示"];
}

function inferSteps(label: string, summary: string, roleLabel: string): string[] {
  const base = [
    `以「${roleLabel}」视角理解任务：${summary}`,
    "列出缺失信息，一次追问不超过 5 个问题",
    "按用户模板或行业惯例组织内容，不编造关键事实",
    "标注需用户确认的数字、日期、人名、承诺条款",
    "给出发送/归档/下一步跟进建议",
  ];
  if (/销售|客户|询盘|报价/.test(label + summary)) {
    base.splice(2, 0, "区分对内备忘与对外可发文案");
  }
  if (/合同|法务|合规/.test(label + summary)) {
    base.splice(1, 0, "只做结构与风险提醒，不输出最终法律意见");
  }
  return base;
}

function mergePlaybook(scenario: SkillStudioScenario, roleLabel: string): Playbook {
  const override = SALES_PLAYBOOKS[scenario.id];
  return {
    askFirst: override?.askFirst ?? [...GENERIC_ASK],
    steps: override?.steps ?? inferSteps(scenario.label, scenario.summary, roleLabel),
    deliverables: override?.deliverables ?? inferDeliverables(scenario.label, scenario.summary),
    cautions: override?.cautions ?? [
      "缺数据时不虚构客户、金额、法条或承诺",
      "对外内容默认需用户最终确认后再发送",
    ],
  };
}

export function renderScenarioPlaybook(
  scenario: SkillStudioScenario,
  roleLabel: string,
  industryLabel: string,
): string {
  const pb = mergePlaybook(scenario, roleLabel);
  return `### ${scenario.label}

**场景定位（${industryLabel} · ${roleLabel}）：** ${scenario.summary}

**先问清楚：**
${pb.askFirst.map((x) => `- ${x}`).join("\n")}

**推荐做法：**
${pb.steps.map((x, i) => `${i + 1}. ${x}`).join("\n")}

**应交付：**
${pb.deliverables.map((x) => `- ${x}`).join("\n")}

**注意：**
${pb.cautions.map((x) => `- ${x}`).join("\n")}`;
}

export function renderCustomScenarioSection(
  customScenarioText: string,
  customNotes: string,
  roleLabel: string,
  industryLabel: string,
): string {
  const body = customScenarioText.trim() || customNotes.trim() || "根据用户在对话中的描述灵活处理。";
  return `### 用户自定义办事场景

**身份上下文：** ${industryLabel} · ${roleLabel}

**用户描述：**
${body}

**处理原则：**
1. 先用 3–5 个问题把任务边界问清楚（时间、对象、材料、格式）。
2. 按用户描述拆解为可执行步骤，不要套固定八股模板。
3. 输出贴近其日常用语和行业习惯的草稿，并标明待确认项。
4. 若涉及专业结论（法律/医疗/税务等），只做到材料整理与风险提示。`;
}
