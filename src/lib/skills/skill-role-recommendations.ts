import { CURATED_SKILL_ENTRIES } from "./curated-skills";

export type RoleSkillRecommendation = {
  dirName: string;
  label: string;
  desc: string;
  /** 组合安装提示（协作链路） */
  bundleHint?: string;
  defaultSelected: boolean;
};

const LABEL_BY_DIR = new Map<string, string>(
  CURATED_SKILL_ENTRIES.map((e) => [e.id as string, e.label]),
);

function rec(
  dirName: string,
  desc: string,
  opts: { bundleHint?: string; defaultSelected?: boolean; label?: string } = {},
): RoleSkillRecommendation {
  return {
    dirName,
    label: opts.label ?? LABEL_BY_DIR.get(dirName) ?? dirName,
    desc,
    bundleHint: opts.bundleHint,
    defaultSelected: opts.defaultSelected ?? true,
  };
}

const TYC_ENTERPRISE = rec("tyc-it", "天眼查：企业背调、股权结构、司法风险与经营真实性核验");
const ANTI_VIBE = rec("anti-vibe-writing", "商务文案、邮件与方案去 AI 味", { defaultSelected: false });
const FULL_OUTPUT = rec("full-output-enforcement", "长文档与清单完整输出不截断", { defaultSelected: false });
const BROWSER = rec("browser-use", "网页查资料、填表、截图与重复性页面操作", { defaultSelected: false });
const CHROME_AUTO = rec("chrome-automation", "控制本机 Chrome 做页面自动化与调试", { defaultSelected: false });
const DESKTOP = rec("desktop-control", "Windows 截图、键鼠与桌面自动化", { defaultSelected: false });
const LEGAL_REVIEW = rec("legal-assistant-skills-main", "合同三层审阅与批注风险清单", { defaultSelected: false });
const RESUME = rec("tailored-resume-generator", "按 JD 定制简历与匹配点提炼", { defaultSelected: false });
const STOCK = rec("stock-analysis", "个股行情、技术指标与走势研判", { defaultSelected: false });
const PDF_PRO = rec("pdf-processing-pro", "PDF 表格/OCR/批量处理与校验", { defaultSelected: false });
const PM_TOOLKIT = rec("product-manager-toolkit", "RICE 排期、PRD 模板与用户研究框架", { defaultSelected: false });

/** 岗位级推荐（industryId/roleId） */
const ROLE_MAP: Record<string, RoleSkillRecommendation[]> = {
  // —— 销售与商务（全员推荐天眼查）——
  "sales/b2b-enterprise": [
    TYC_ENTERPRISE,
    rec("anti-vibe-writing", "方案书、高管邮件去 AI 味，更贴近商务口吻"),
    rec("full-output-enforcement", "招投标应答与作战地图完整输出"),
    BROWSER,
  ],
  "sales/inside-sales": [TYC_ENTERPRISE, rec("anti-vibe-writing", "陌拜/跟进话术润色"), BROWSER],
  "sales/channel-sales": [
    TYC_ENTERPRISE,
    ANTI_VIBE,
  ],
  "sales/retail-sales": [TYC_ENTERPRISE, ANTI_VIBE],
  "sales/account-manager": [
    TYC_ENTERPRISE,
    rec("anti-vibe-writing", "QBR 纪要、续费沟通稿润色"),
    FULL_OUTPUT,
  ],
  "sales/pre-sales": [
    TYC_ENTERPRISE,
    rec("anti-vibe-writing", "RFP/POC 方案润色"),
    rec("bilingual-pdf-translation", "英文标书/规格对照", { defaultSelected: false }),
    BROWSER,
  ],

  // —— 法务合规 ——
  "legal-compliance/ip-specialist": [
    rec("paper-to-patent", "论文/技术报告→中国发明专利初稿，含证据台账"),
    rec("scipilot-writing", "专利说明书语言润色与逻辑自检", {
      bundleHint: "与论文转专利组合",
    }),
    rec("scipilot-cite", "现有技术检索与引用格式化", { defaultSelected: false }),
    rec("tyc-it", "专利权人/受让方主体核验", { defaultSelected: false }),
  ],
  "legal-compliance/contract-review": [
    LEGAL_REVIEW,
    TYC_ENTERPRISE,
    rec("bilingual-pdf-translation", "涉外合同双语对照审阅"),
    ANTI_VIBE,
  ],
  "legal-compliance/compliance-officer": [
    TYC_ENTERPRISE,
    LEGAL_REVIEW,
    rec("bilingual-pdf-translation", "制度/监管文件对照", { defaultSelected: false }),
  ],

  // —— 财务税务 ——
  "finance-tax/financial-analyst": [STOCK, FULL_OUTPUT, rec("tyc-it", "标的公司/交易对手尽调", { defaultSelected: false })],
  "finance-tax/accountant": [PDF_PRO, FULL_OUTPUT],
  "finance-tax/tax-specialist": [PDF_PRO, FULL_OUTPUT],
  "finance-tax/ar-ap": [TYC_ENTERPRISE, FULL_OUTPUT, ANTI_VIBE],

  // —— 人力行政 ——
  "admin-hr/recruiter": [RESUME, ANTI_VIBE, FULL_OUTPUT],
  "admin-hr/hrbp": [ANTI_VIBE, FULL_OUTPUT],
  "admin-hr/admin-assistant": [DESKTOP, PDF_PRO, ANTI_VIBE],
  "admin-hr/medical-admin": [ANTI_VIBE, FULL_OUTPUT],

  // —— 外贸跨境 ——
  "foreign-trade/sales-follow": [CHROME_AUTO, rec("anti-vibe-writing", "英文询盘回复去模板腔"), FULL_OUTPUT],
  "foreign-trade/document-specialist": [
    rec("bilingual-pdf-translation", "单证、规格书双语对照核对"),
    PDF_PRO,
    FULL_OUTPUT,
  ],
  "foreign-trade/logistics-coord": [FULL_OUTPUT, BROWSER],
  "foreign-trade/cross-border-ops": [CHROME_AUTO, BROWSER, rec("anti-vibe-writing", "Listing/差评回复润色")],

  // —— 内容营销 ——
  "content-marketing/content-planner": [
    rec("anti-vibe-writing", "选题 Brief、社媒文案去 AI 味"),
    FULL_OUTPUT,
  ],
  "content-marketing/copywriter": [
    rec("anti-vibe-writing", "品牌文案、落地页、邮件去 AI 腔"),
    FULL_OUTPUT,
  ],
  "content-marketing/social-media": [rec("anti-vibe-writing", "微博/小红书/推文等短内容人性化")],
  "content-marketing/brand-pr": [
    rec("anti-vibe-writing", "新闻稿、品牌故事去 consultant-speak"),
    FULL_OUTPUT,
  ],

  // —— 教育培训 ——
  "education/teacher": [
    rec("anti-vibe-writing", "教案、反馈信、家长通知去 AI 味"),
    rec("scipilot-writing", "学术讲义润色", { defaultSelected: false }),
  ],
  "education/academic-affairs": [
    rec("anti-vibe-writing", "制度通知、考务说明人性化改写"),
    rec("bilingual-pdf-translation", "双语规章对照", { defaultSelected: false }),
  ],
  "education/admissions": [ANTI_VIBE, BROWSER],
  "education/student-success": [ANTI_VIBE, FULL_OUTPUT],

  // —— 咨询 ——
  "consulting/management-consultant": [
    TYC_ENTERPRISE,
    rec("anti-vibe-writing", "汇报材料、建议书去空泛顾问腔"),
    FULL_OUTPUT,
  ],
  "consulting/it-consultant": [
    rec("skills-best-practices", "为客户编写可维护 Agent 技能", { defaultSelected: false }),
    FULL_OUTPUT,
    BROWSER,
  ],

  // —— 研发 ——
  "software-rd/product-manager": [
    PM_TOOLKIT,
    rec("skills-best-practices", "为团队编写可维护的 Agent 技能"),
    rec("skill-development", "技能结构与渐进式披露"),
    FULL_OUTPUT,
  ],
  "software-rd/developer": [
    rec("skills-best-practices", "编写项目内自定义技能与脚本"),
    rec("skill-development", "官方技能开发最佳实践"),
    BROWSER,
  ],
  "software-rd/qa-engineer": [FULL_OUTPUT, BROWSER, rec("skills-best-practices", "测试类技能模板", { defaultSelected: false })],
  "software-rd/devops": [FULL_OUTPUT, DESKTOP, BROWSER],

  // —— 智能制造 ——
  "smart-manufacturing/quality-engineer": [
    rec("bilingual-pdf-translation", "外来标准/规格书双语对照", { defaultSelected: false }),
    FULL_OUTPUT,
    PDF_PRO,
  ],
  "smart-manufacturing/production-planner": [FULL_OUTPUT, PDF_PRO],
  "smart-manufacturing/process-engineer": [FULL_OUTPUT, rec("bilingual-pdf-translation", "工艺文件对照", { defaultSelected: false })],

  // —— 客户服务 ——
  "customer-service/online-support": [BROWSER, ANTI_VIBE],
  "customer-service/after-sales": [BROWSER, ANTI_VIBE, FULL_OUTPUT],

  // —— 房地产 ——
  "real-estate/new-home-consultant": [TYC_ENTERPRISE, ANTI_VIBE, BROWSER],
  "real-estate/leasing-agent": [ANTI_VIBE, BROWSER],

  // —— 自定义 ——
  "custom/freeform": [
    rec("skills-best-practices", "学会编写适合自己的 Agent 技能"),
    FULL_OUTPUT,
    ANTI_VIBE,
  ],
};

/** 场景加成：选中场景时追加推荐 */
const SCENARIO_BOOST: Record<string, RoleSkillRecommendation[]> = {
  "paper-to-patent-draft": [
    rec("paper-to-patent", "论文→专利初稿流水线", { defaultSelected: true }),
    rec("scipilot-writing", "权利要求与说明书润色", { bundleHint: "与论文转专利组合" }),
  ],
  "account-plan": [TYC_ENTERPRISE],
  "discovery-call": [TYC_ENTERPRISE],
  "bid-review": [TYC_ENTERPRISE, FULL_OUTPUT],
  "vendor-dd": [TYC_ENTERPRISE],
  "brief-write": [rec("anti-vibe-writing", "Brief 与提纲去 AI 腔")],
  "health-education": [rec("anti-vibe-writing", "患者宣教稿通俗易懂改写")],
  "inquiry-reply": [rec("anti-vibe-writing", "外贸邮件自然化润色"), CHROME_AUTO],
  "proposal-outline": [rec("anti-vibe-writing", "方案叙述去模板腔"), TYC_ENTERPRISE],
  "patent-disclosure": [rec("paper-to-patent", "技术交底→专利初稿", { defaultSelected: true })],
  "jd-write": [RESUME],
  "screen-resume": [RESUME],
  "clause-risk": [LEGAL_REVIEW, TYC_ENTERPRISE],
  "customs-checklist": [rec("bilingual-pdf-translation", "报关单证双语核对")],
  "listing-copy": [CHROME_AUTO, rec("anti-vibe-writing", "跨境 Listing 文案润色")],
};

const INDUSTRY_DEFAULTS: Record<string, RoleSkillRecommendation[]> = {
  sales: [TYC_ENTERPRISE],
  "legal-compliance": [
    rec("bilingual-pdf-translation", "法务文档双语对照", { defaultSelected: false }),
  ],
  "finance-tax": [rec("full-output-enforcement", "报表与说明完整输出", { defaultSelected: false })],
  "content-marketing": [
    rec("anti-vibe-writing", "内容营销文案人性化"),
    FULL_OUTPUT,
  ],
  education: [rec("anti-vibe-writing", "教学与沟通文稿润色")],
  "software-rd": [
    rec("skills-best-practices", "团队技能编写规范"),
    rec("skill-development", "技能结构与元数据优化"),
  ],
  "foreign-trade": [CHROME_AUTO],
  "admin-hr": [ANTI_VIBE],
  "customer-service": [BROWSER],
  "real-estate": [TYC_ENTERPRISE],
  consulting: [TYC_ENTERPRISE],
};

function dedupeByDir(items: RoleSkillRecommendation[]): RoleSkillRecommendation[] {
  const seen = new Set<string>();
  const out: RoleSkillRecommendation[] = [];
  for (const item of items) {
    if (seen.has(item.dirName)) continue;
    seen.add(item.dirName);
    out.push(item);
  }
  return out;
}

export function getRoleSkillRecommendations(
  industryId: string,
  roleId: string,
  scenarioIds: string[] = [],
): RoleSkillRecommendation[] {
  const key = `${industryId}/${roleId}`;
  const fromRole = ROLE_MAP[key] ?? [];
  const fromIndustry =
    industryId === "custom" ? ROLE_MAP["custom/freeform"] ?? [] : INDUSTRY_DEFAULTS[industryId] ?? [];
  const fromScenarios = scenarioIds.flatMap((id) => SCENARIO_BOOST[id] ?? []);
  return dedupeByDir([...fromRole, ...fromIndustry, ...fromScenarios]);
}

export function defaultSelectedRecommendationDirs(
  industryId: string,
  roleId: string,
  scenarioIds: string[] = [],
): string[] {
  return getRoleSkillRecommendations(industryId, roleId, scenarioIds)
    .filter((r) => r.defaultSelected)
    .map((r) => r.dirName);
}
