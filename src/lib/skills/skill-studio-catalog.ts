export type SkillStudioScenario = {
  id: string;
  label: string;
  summary: string;
};

export type SkillStudioRole = {
  id: string;
  label: string;
  scenarios: SkillStudioScenario[];
};

export type SkillStudioIndustry = {
  id: string;
  label: string;
  description: string;
  /** 用户自填行业/岗位，无预制场景 */
  custom?: boolean;
  roles: SkillStudioRole[];
};

export const SKILL_STUDIO_CATALOG: SkillStudioIndustry[] = [
  {
    id: "smart-manufacturing",
    label: "智能制造",
    description: "生产、质量、设备与供应链协同",
    roles: [
      {
        id: "production-planner",
        label: "生产计划员",
        scenarios: [
          { id: "schedule-adjust", label: "排产调整", summary: "根据缺料与交期冲突重排产线计划" },
          { id: "capacity-brief", label: "产能简报", summary: "汇总本周产能利用率与瓶颈工序" },
          { id: "material-shortage", label: "缺料预警", summary: "对照 BOM 识别缺料并给出替代方案" },
          { id: "shift-handover", label: "班次交接", summary: "整理当班异常、在制与待办清单" },
          { id: "delivery-commit", label: "交期承诺", summary: "评估新订单交期是否可承诺及风险点" },
        ],
      },
      {
        id: "quality-engineer",
        label: "质量工程师",
        scenarios: [
          { id: "8d-draft", label: "8D 报告草稿", summary: "根据不良描述起草 8D 初稿与纠正措施" },
          { id: "spc-summary", label: "SPC 异常汇总", summary: "解读控制图超限点并建议处置" },
          { id: "inspection-checklist", label: "检验清单", summary: "按产品型号生成来料/过程检验项" },
          { id: "customer-complaint", label: "客诉回复", summary: "起草对客户质量投诉的正式回复" },
          { id: "capa-track", label: "CAPA 跟踪", summary: "汇总未关闭 CAPA 与逾期项" },
        ],
      },
      {
        id: "equipment-maint",
        label: "设备维护",
        scenarios: [
          { id: "pm-plan", label: "保养计划", summary: "按设备台账生成月度 PM 计划" },
          { id: "fault-diagnosis", label: "故障初诊", summary: "根据报警代码与现象给出排查步骤" },
          { id: "spare-parts", label: "备件申请", summary: "整理备件需求与替代型号说明" },
          { id: "downtime-report", label: "停机分析", summary: "汇总停机原因与 MTBF/MTTR 要点" },
        ],
      },
      {
        id: "process-engineer",
        label: "工艺工程师",
        scenarios: [
          { id: "pfmea-update", label: "PFMEA 更新", summary: "根据变更点提示 PFMEA 需修订条目" },
          { id: "work-instruction", label: "作业指导书", summary: "将工艺变更整理为 SOP 要点" },
          { id: "trial-run", label: "试产总结", summary: "汇总试产数据与放行建议" },
          { id: "yield-analysis", label: "良率分析", summary: "按工序拆解良率损失与改善方向" },
          { id: "ecn-brief", label: "工程变更说明", summary: "起草 ECN 影响范围与实施检查项" },
        ],
      },
    ],
  },
  {
    id: "foreign-trade",
    label: "外贸跨境",
    description: "询盘、单证、物流与跨境合规",
    roles: [
      {
        id: "sales-follow",
        label: "外贸业务员",
        scenarios: [
          { id: "inquiry-reply", label: "询盘回复", summary: "根据产品参数起草英文询盘回复" },
          { id: "quotation", label: "报价单要点", summary: "整理报价条款、MOQ 与交期说明" },
          { id: "sample-chase", label: "样品催办", summary: "起草催样/确认收样的跟进邮件" },
          { id: "pi-draft", label: "形式发票", summary: "根据订单要素整理 PI 字段清单" },
          { id: "objection-handle", label: "异议处理", summary: "针对价格/交期异议给出回复思路" },
        ],
      },
      {
        id: "document-specialist",
        label: "单证专员",
        scenarios: [
          { id: "customs-checklist", label: "报关核对", summary: "对照合同核对报关要素与 HS 编码" },
          { id: "bl-review", label: "提单审核", summary: "检查提单信息与信用证一致性" },
          { id: "co-origin", label: "原产地证", summary: "整理原产地证申请所需材料清单" },
          { id: "lc-clause", label: "信用证条款", summary: "提炼 L/C 软条款与不符点风险" },
          { id: "invoice-pack", label: "发票箱单", summary: "按出货批次生成发票箱单字段" },
        ],
      },
      {
        id: "logistics-coord",
        label: "物流协调",
        scenarios: [
          { id: "booking-brief", label: "订舱要点", summary: "汇总柜型、港口与截关时间" },
          { id: "freight-compare", label: "运价对比", summary: "整理多货代报价对比表要点" },
          { id: "delay-notice", label: "延误通知", summary: "起草船期延误对客户的说明" },
          { id: "warehouse-inout", label: "出入库跟进", summary: "汇总待出库批次与单证状态" },
        ],
      },
      {
        id: "cross-border-ops",
        label: "跨境运营",
        scenarios: [
          { id: "listing-copy", label: "Listing 优化", summary: "优化跨境平台商品标题与卖点" },
          { id: "review-response", label: "差评回复", summary: "起草专业、合规的买家评价回复" },
          { id: "promo-plan", label: "促销方案", summary: "整理活动节奏、折扣与库存约束" },
          { id: "return-policy", label: "退货说明", summary: "生成清晰的退换货政策说明" },
          { id: "compliance-label", label: "合规标签", summary: "核对目标市场标签与认证要求" },
        ],
      },
    ],
  },
  {
    id: "sales",
    label: "销售与商务",
    description: "获客、跟进、报价、谈判与回款",
    roles: [
      {
        id: "b2b-enterprise",
        label: "B2B 大客户销售",
        scenarios: [
          { id: "account-plan", label: "客户作战地图", summary: "梳理决策链、痛点、竞品与推进节奏" },
          { id: "discovery-call", label: "需求探询", summary: "准备首次拜访/电话的提问清单与纪要模板" },
          { id: "proposal-outline", label: "方案提纲", summary: "按客户痛点生成解决方案与价值陈述" },
          { id: "bid-review", label: "招投标要点", summary: "提炼招标文件废标项与应答结构" },
          { id: "exec-brief", label: "高层汇报", summary: "给决策者的一页纸摘要与 ROI 要点" },
          { id: "lost-deal-review", label: "输单复盘", summary: "归纳丢单原因与下次改进动作" },
        ],
      },
      {
        id: "inside-sales",
        label: "电话/线上销售",
        scenarios: [
          { id: "cold-call-script", label: "陌拜话术", summary: "30 秒开场 + 3 个探需问题 + 约访收口" },
          { id: "follow-up-sequence", label: "跟进节奏", summary: "按未回复/犹豫/比价阶段设计跟进话术" },
          { id: "demo-agenda", label: "演示议程", summary: "30 分钟产品演示流程与客户关注点" },
          { id: "objection-price", label: "价格异议", summary: "价值锚定、分期/打包等应对话术" },
          { id: "trial-chase", label: "试用催办", summary: "试用第 3/7 天激活与到期转化提醒" },
        ],
      },
      {
        id: "channel-sales",
        label: "渠道与合作",
        scenarios: [
          { id: "partner-onboard", label: "伙伴入驻", summary: "渠道政策、分级权益与签约清单" },
          { id: "co-marketing", label: "联合营销", summary: "联合活动方案、分工与物料清单" },
          { id: "deal-reg", label: "商机报备", summary: "冲突判定要点与报备邮件模板" },
          { id: "rebate-settle", label: "返利结算", summary: "对账差异说明与结算申请要点" },
        ],
      },
      {
        id: "retail-sales",
        label: "门店/零售销售",
        scenarios: [
          { id: "floor-talk", label: "接待话术", summary: "进店 30 秒破冰与需求三问" },
          { id: "upsell-bundle", label: "连带推荐", summary: "根据已选 SKU 推荐搭配与优惠组合" },
          { id: "promo-script", label: "活动口播", summary: "周末促销/会员日口播与立牌文案" },
          { id: "complaint-sales", label: "现场异议", summary: "犹豫、比价、售后顾虑的现场应答" },
        ],
      },
      {
        id: "account-manager",
        label: "客户经理/续费",
        scenarios: [
          { id: "qbr-prep", label: "季度复盘", summary: "用量、价值回顾与下季度共创议题" },
          { id: "renewal-risk", label: "续费风险", summary: "识别降配/流失信号与挽留方案" },
          { id: "expansion-play", label: "增购机会", summary: "从使用数据挖掘扩容/交叉销售切入点" },
          { id: "escalation-mail", label: "升级邮件", summary: "客户投诉升级对内协同与对外回复" },
        ],
      },
      {
        id: "pre-sales",
        label: "售前顾问",
        scenarios: [
          { id: "rfp-response", label: "RFP 应答", summary: "技术/商务应答矩阵与分工计划" },
          { id: "poc-plan", label: "POC 方案", summary: "验证目标、环境、成功标准与时间表" },
          { id: "integration-brief", label: "集成说明", summary: "与客户 IT 沟通的接口/部署要点" },
          { id: "compete-battlecard", label: "竞品对战卡", summary: "差异化话术与常见陷阱澄清" },
          { id: "handover-pack", label: "交付移交", summary: "售前转实施的需求与承诺清单" },
        ],
      },
    ],
  },
  {
    id: "legal-compliance",
    label: "法务合规",
    description: "合同、知产、内控与监管应对",
    roles: [
      {
        id: "contract-review",
        label: "合同审查",
        scenarios: [
          { id: "clause-risk", label: "条款风险", summary: "标注合同中的责任、违约与管辖风险" },
          { id: "compare-redline", label: "比对红线", summary: "对照公司标准条款给出修改建议" },
          { id: "nda-check", label: "保密协议", summary: "检查 NDA 期限、范围与返还义务" },
          { id: "payment-terms", label: "付款条款", summary: "评估付款节点与担保措施是否充分" },
        ],
      },
      {
        id: "ip-specialist",
        label: "知识产权",
        scenarios: [
          { id: "trademark-search", label: "商标检索要点", summary: "整理商标近似检索维度与结论框架" },
          { id: "infringement-brief", label: "侵权函草稿", summary: "起草律师函/警告函要点（非法律意见）" },
          { id: "license-summary", label: "许可协议摘要", summary: "提炼许可范围、地域与分成条款" },
          { id: "patent-disclosure", label: "技术交底整理", summary: "将技术方案整理为专利申请要点" },
          { id: "paper-to-patent-draft", label: "论文转专利初稿", summary: "从论文生成权利要求与说明书初稿（证据台账）" },
        ],
      },
      {
        id: "compliance-officer",
        label: "合规专员",
        scenarios: [
          { id: "policy-gap", label: "制度缺口", summary: "对照法规列出现有制度缺口" },
          { id: "training-outline", label: "合规培训", summary: "生成合规培训大纲与测验题要点" },
          { id: "audit-prep", label: "迎审准备", summary: "整理迎审材料清单与责任人" },
          { id: "incident-report", label: "事件报告", summary: "起草合规事件初步报告结构" },
          { id: "vendor-dd", label: "供应商尽调", summary: "生成供应商合规尽调问卷要点" },
        ],
      },
    ],
  },
  {
    id: "finance-tax",
    label: "财务税务",
    description: "核算、报表、资金与税务申报",
    roles: [
      {
        id: "accountant",
        label: "会计",
        scenarios: [
          { id: "voucher-review", label: "凭证复核", summary: "检查凭证附件、科目与金额勾稽" },
          { id: "reconcile", label: "往来对账", summary: "整理与客户/供应商对账差异说明" },
          { id: "close-checklist", label: "月结清单", summary: "生成月末结账检查项与截止动作" },
          { id: "expense-audit", label: "费用审核", summary: "按制度审核报销单据合规性" },
        ],
      },
      {
        id: "financial-analyst",
        label: "财务分析",
        scenarios: [
          { id: "mgmt-report", label: "经营简报", summary: "汇总收入、毛利、费用异动说明" },
          { id: "budget-variance", label: "预算差异", summary: "分析预算 vs 实际差异原因" },
          { id: "cashflow-forecast", label: "现金流预测", summary: "整理未来 13 周现金流假设" },
          { id: "kpi-dashboard", label: "指标解读", summary: "解读关键财务指标变化与行动建议" },
          { id: "investment-memo", label: "投资备忘", summary: "起草资本开支项目简要可研要点" },
        ],
      },
      {
        id: "tax-specialist",
        label: "税务",
        scenarios: [
          { id: "vat-prep", label: "增值税准备", summary: "整理进项销项勾稽与申报注意点" },
          { id: "cit-adjust", label: "所得税调整", summary: "列示纳税调整项与依据" },
          { id: "invoice-issue", label: "开票信息", summary: "核对开票抬头、税率与品类" },
          { id: "tax-risk", label: "税务风险", summary: "识别交易结构中的税务风险点" },
        ],
      },
      {
        id: "ar-ap",
        label: "应收应付",
        scenarios: [
          { id: "collection-letter", label: "催收函", summary: "起草应收账款催收邮件/函件" },
          { id: "payment-apply", label: "付款申请", summary: "整理付款申请理由与审批附件" },
          { id: "aging-analysis", label: "账龄分析", summary: "汇总账龄分布与重点客户" },
          { id: "credit-limit", label: "信用评估", summary: "根据交易记录给出信用额度建议" },
        ],
      },
    ],
  },
  {
    id: "education",
    label: "教育培训",
    description: "教研、教务、招生与学员服务",
    roles: [
      {
        id: "teacher",
        label: "任课教师",
        scenarios: [
          { id: "lesson-plan", label: "教案大纲", summary: "按课时目标生成教案结构与活动" },
          { id: "quiz-design", label: "测验设计", summary: "根据知识点生成测验题与评分标准" },
          { id: "parent-feedback", label: "家校反馈", summary: "起草学生阶段表现反馈话术" },
          { id: "class-summary", label: "课堂总结", summary: "整理当堂重点、作业与下节预告" },
        ],
      },
      {
        id: "academic-affairs",
        label: "教务管理",
        scenarios: [
          { id: "schedule-conflict", label: "排课冲突", summary: "识别教室/教师排课冲突并给方案" },
          { id: "exam-arrange", label: "考务安排", summary: "生成考试日程、监考与考场分配要点" },
          { id: "attendance-report", label: "出勤报表", summary: "汇总缺勤趋势与预警学员" },
          { id: "policy-notice", label: "制度通知", summary: "起草学籍/考勤制度变更通知" },
        ],
      },
      {
        id: "admissions",
        label: "招生顾问",
        scenarios: [
          { id: "consult-script", label: "咨询话术", summary: "针对家长顾虑生成咨询应答要点" },
          { id: "open-day", label: "开放日文案", summary: "撰写开放日宣传与流程说明" },
          { id: "follow-up", label: "线索跟进", summary: "整理试听未报名客户的跟进计划" },
          { id: "brochure-outline", label: "简章要点", summary: "提炼课程卖点与班型对比" },
          { id: "objection-faq", label: "异议 FAQ", summary: "汇总价格/效果类常见异议应答" },
        ],
      },
      {
        id: "student-success",
        label: "学管师",
        scenarios: [
          { id: "learning-plan", label: "学习计划", summary: "为学员制定周学习计划与打卡项" },
          { id: "renewal-talk", label: "续费沟通", summary: "根据学习数据起草续费沟通要点" },
          { id: "complaint-handle", label: "投诉处理", summary: "整理投诉受理与回访步骤" },
          { id: "progress-report", label: "阶段报告", summary: "生成学员阶段学习报告框架" },
        ],
      },
    ],
  },
  {
    id: "content-marketing",
    label: "内容营销",
    description: "选题、文案、社媒与品牌传播",
    roles: [
      {
        id: "content-planner",
        label: "内容策划",
        scenarios: [
          { id: "topic-calendar", label: "选题日历", summary: "按节日/热点生成一周选题表" },
          { id: "brief-write", label: "需求 Brief", summary: "将业务目标整理为内容 Brief" },
          { id: "competitor-scan", label: "竞品扫描", summary: "汇总竞品近期内容角度与差异点" },
          { id: "campaign-outline", label: "Campaign 大纲", summary: "策划整合营销活动节奏与素材清单" },
        ],
      },
      {
        id: "copywriter",
        label: "文案",
        scenarios: [
          { id: "headline-variants", label: "标题变体", summary: "同一主题生成多风格标题" },
          { id: "product-copy", label: "产品文案", summary: "提炼卖点、场景与 CTA" },
          { id: "email-sequence", label: "邮件序列", summary: "设计培育邮件主题与结构" },
          { id: "case-study", label: "客户案例", summary: "将项目经历整理为案例故事框架" },
          { id: "tone-adjust", label: "语气润色", summary: "按品牌调性改写现有文案" },
        ],
      },
      {
        id: "social-media",
        label: "新媒体运营",
        scenarios: [
          { id: "post-pack", label: "发帖包", summary: "生成图文/短视频脚本与标签" },
          { id: "comment-reply", label: "评论回复", summary: "起草评论区互动与危机回复" },
          { id: "live-outline", label: "直播提纲", summary: "整理直播流程、话术与福利点" },
          { id: "data-review", label: "数据复盘", summary: "解读播放/互动数据并给优化点" },
        ],
      },
      {
        id: "brand-pr",
        label: "品牌公关",
        scenarios: [
          { id: "press-release", label: "新闻稿", summary: "起草活动/融资新闻稿结构" },
          { id: "media-qna", label: "媒体 Q&A", summary: "准备媒体采访常见问题应答" },
          { id: "crisis-statement", label: "声明草稿", summary: "起草危机公关声明要点（待法务审）" },
          { id: "speaker-notes", label: "演讲提纲", summary: "整理发布会/演讲核心信息" },
        ],
      },
    ],
  },
  {
    id: "admin-hr",
    label: "行政人事",
    description: "招聘、员工关系、行政与办公协同",
    roles: [
      {
        id: "recruiter",
        label: "招聘",
        scenarios: [
          { id: "jd-write", label: "JD 撰写", summary: "根据岗位画像生成招聘 JD" },
          { id: "screen-resume", label: "简历筛选", summary: "按胜任力模型整理简历匹配点" },
          { id: "interview-kit", label: "面试题包", summary: "生成结构化面试题与评分表" },
          { id: "offer-letter", label: "录用通知", summary: "起草 Offer 要素与沟通话术" },
          { id: "pipeline-report", label: "招聘漏斗", summary: "汇总各阶段转化率与瓶颈" },
        ],
      },
      {
        id: "hrbp",
        label: "HRBP",
        scenarios: [
          { id: "perf-talk", label: "绩效面谈", summary: "准备绩效面谈提纲与反馈话术" },
          { id: "onboarding", label: "入职清单", summary: "生成新员工入职一周任务清单" },
          { id: "policy-explain", label: "制度解读", summary: "将 HR 制度改写为员工易懂版" },
          { id: "org-change-comms", label: "组织变更沟通", summary: "起草部门调整内部沟通稿" },
        ],
      },
      {
        id: "admin-assistant",
        label: "行政助理",
        scenarios: [
          { id: "meeting-minutes", label: "会议纪要", summary: "将会议记录整理为纪要格式" },
          { id: "travel-arrange", label: "差旅安排", summary: "汇总行程、酒店与报销提醒" },
          { id: "office-notice", label: "行政通知", summary: "起草办公区/后勤类通知" },
          { id: "vendor-compare", label: "供应商比价", summary: "整理办公采购比价要点" },
          { id: "event-checklist", label: "活动清单", summary: "生成会务/活动筹备检查表" },
        ],
      },
      {
        id: "medical-admin",
        label: "医疗行政",
        scenarios: [
          { id: "appointment-guide", label: "就诊指引", summary: "整理患者预约与就诊流程说明" },
          { id: "insurance-claim", label: "医保材料", summary: "列示报销所需材料与注意点" },
          { id: "health-education", label: "健康宣教", summary: "将专业内容改写为患者易懂稿" },
          { id: "dept-schedule", label: "科室排班", summary: "汇总门诊排班与替班冲突" },
        ],
      },
    ],
  },
  {
    id: "real-estate",
    label: "房地产",
    description: "新房、二手房、租赁与园区招商",
    roles: [
      {
        id: "new-home-consultant",
        label: "新房顾问",
        scenarios: [
          { id: "project-brief", label: "楼盘卖点", summary: "按客群提炼地段、户型、学区与首付方案" },
          { id: "visit-script", label: "带看话术", summary: "动线讲解、竞品对比与逼定收口" },
          { id: "mortgage-calc", label: "按揭测算", summary: "月供、税费与资格提醒（非最终核定）" },
          { id: "wechat-follow", label: "微信跟进", summary: "看房后 24h/72h 跟进文案" },
        ],
      },
      {
        id: "leasing-agent",
        label: "租赁经纪",
        scenarios: [
          { id: "listing-copy", label: "房源文案", summary: "标题、亮点、交通与适合人群" },
          { id: "tenant-screen", label: "租客问询", summary: "资质、租期、押付方式确认清单" },
          { id: "contract-checklist", label: "签约清单", summary: "合同附件、交割清单与费用明细" },
        ],
      },
    ],
  },
  {
    id: "consulting",
    label: "咨询顾问",
    description: "访谈、分析、汇报与项目管理",
    roles: [
      {
        id: "management-consultant",
        label: "管理咨询",
        scenarios: [
          { id: "issue-tree", label: "问题拆解", summary: "MECE 问题树与假设清单" },
          { id: "interview-guide", label: "访谈提纲", summary: "干系人访谈问题与记录模板" },
          { id: "deck-storyline", label: "汇报 storyline", summary: "金字塔结论与章节页要点" },
          { id: "workshop-facilitate", label: "研讨会设计", summary: "议程、分组讨论与产出模板" },
        ],
      },
      {
        id: "it-consultant",
        label: "IT 咨询",
        scenarios: [
          { id: "current-state", label: "现状评估", summary: "系统架构、痛点与约束整理" },
          { id: "roadmap-draft", label: "路线图草案", summary: "分阶段目标、依赖与里程碑" },
          { id: "raci-matrix", label: "RACI 分工", summary: "项目角色与责任矩阵" },
        ],
      },
    ],
  },
  {
    id: "customer-service",
    label: "客户服务",
    description: "售前咨询、售后支持与投诉处理",
    roles: [
      {
        id: "online-support",
        label: "在线客服",
        scenarios: [
          { id: "faq-answer", label: "标准答疑", summary: "按知识库口径回答并附操作步骤" },
          { id: "ticket-summary", label: "工单摘要", summary: "将长对话整理为可流转工单" },
          { id: "angry-customer", label: "情绪安抚", summary: "致歉、共情、解决路径三步话术" },
          { id: "escalation", label: "升级判断", summary: "何时升级二线/主管的判定要点" },
        ],
      },
      {
        id: "after-sales",
        label: "售后服务",
        scenarios: [
          { id: "warranty-check", label: "保修判定", summary: "序列号、购买凭证与保修政策核对" },
          { id: "return-process", label: "退换流程", summary: "条件、时效与物流指引" },
          { id: "repair-status", label: "维修进度", summary: "向客户同步节点与预计完成时间" },
        ],
      },
    ],
  },
  {
    id: "logistics",
    label: "物流供应链",
    description: "仓储、运输、关务与计划",
    roles: [
      {
        id: "warehouse-ops",
        label: "仓储运营",
        scenarios: [
          { id: "inbound-check", label: "入库验收", summary: "到货差异、破损与系统过账要点" },
          { id: "pick-pack", label: "拣配异常", summary: "缺货、错拣处理与补发建议" },
          { id: "inventory-cycle", label: "盘点差异", summary: "循环盘点差异原因与调整申请" },
        ],
      },
      {
        id: "transport-planner",
        label: "运输调度",
        scenarios: [
          { id: "route-plan", label: "线路规划", summary: "车型、装载率与时效平衡" },
          { id: "carrier-claim", label: "承运索赔", summary: "货损货差取证与索赔函要点" },
          { id: "eta-update", label: "在途更新", summary: "延误原因与预计到港/到仓说明" },
        ],
      },
    ],
  },
  {
    id: "design-creative",
    label: "设计创意",
    description: "品牌、平面、空间与视觉交付",
    roles: [
      {
        id: "brand-designer",
        label: "品牌设计",
        scenarios: [
          { id: "brief-decode", label: "需求解读", summary: "从客户简报提炼目标、受众与禁忌" },
          { id: "moodboard", label: "情绪板说明", summary: "色彩、字体、风格关键词与参考" },
          { id: "revision-log", label: "改稿说明", summary: "版本差异与客户确认点记录" },
        ],
      },
      {
        id: "ui-designer",
        label: "UI/UX 设计",
        scenarios: [
          { id: "flow-review", label: "流程走查", summary: "主路径断点、空状态与错误态清单" },
          { id: "handoff-notes", label: "交付标注", summary: "组件状态、间距与开发备注" },
          { id: "usability-findings", label: "可用性发现", summary: "测试问题分级与改法建议" },
        ],
      },
    ],
  },
  {
    id: "custom",
    label: "其他",
    description: "不在列表中？自己描述行业、岗位和办事场景",
    custom: true,
    roles: [
      {
        id: "freeform",
        label: "自定义岗位",
        scenarios: [],
      },
    ],
  },
  {
    id: "software-rd",
    label: "软件研发",
    description: "需求、开发、测试与交付协作",
    roles: [
      {
        id: "product-manager",
        label: "产品经理",
        scenarios: [
          { id: "prd-outline", label: "PRD 大纲", summary: "将需求整理为 PRD 章节与验收标准" },
          { id: "user-story", label: "用户故事", summary: "拆分 Epic 为可交付用户故事" },
          { id: "release-note", label: "版本说明", summary: "起草面向用户的 Release Notes" },
          { id: "competitive-prd", label: "竞品功能对比", summary: "整理竞品功能矩阵与差距" },
          { id: "stakeholder-update", label: "干系人同步", summary: "生成项目周报与风险项" },
        ],
      },
      {
        id: "developer",
        label: "开发工程师",
        scenarios: [
          { id: "tech-design", label: "技术方案", summary: "根据需求起草技术方案与接口设计" },
          { id: "code-review", label: "Code Review", summary: "按变更生成 Review 检查清单" },
          { id: "refactor-plan", label: "重构计划", summary: "识别技术债并给分阶段重构步骤" },
          { id: "incident-postmortem", label: "故障复盘", summary: "整理线上事故时间线与改进项" },
        ],
      },
      {
        id: "qa-engineer",
        label: "测试工程师",
        scenarios: [
          { id: "test-plan", label: "测试计划", summary: "生成测试范围、环境与准入标准" },
          { id: "test-cases", label: "用例设计", summary: "按需求生成核心测试用例" },
          { id: "bug-report", label: "缺陷报告", summary: "将现象整理为标准缺陷描述" },
          { id: "regression-pack", label: "回归包", summary: "列出发版前回归测试清单" },
          { id: "uat-script", label: "UAT 脚本", summary: "为业务方编写验收操作步骤" },
        ],
      },
      {
        id: "devops",
        label: "运维/DevOps",
        scenarios: [
          { id: "runbook", label: "Runbook", summary: "将操作步骤整理为运维手册" },
          { id: "deploy-checklist", label: "发布检查", summary: "生成发布前/后检查项" },
          { id: "alert-triage", label: "告警初诊", summary: "根据告警信息给排查路径" },
          { id: "capacity-plan", label: "容量评估", summary: "汇总资源使用与扩容建议" },
        ],
      },
      {
        id: "tech-writer",
        label: "技术文档",
        scenarios: [
          { id: "api-doc", label: "API 文档", summary: "将接口草稿整理为开发者文档结构" },
          { id: "user-guide", label: "用户手册", summary: "生成面向终端用户的操作指南大纲" },
          { id: "changelog", label: "变更日志", summary: "从提交/需求整理 CHANGELOG 条目" },
          { id: "faq-compile", label: "FAQ 汇编", summary: "汇总常见问题与标准答复" },
        ],
      },
    ],
  },
];

export function findIndustry(id: string): SkillStudioIndustry | undefined {
  return SKILL_STUDIO_CATALOG.find((i) => i.id === id);
}

export function findRole(industryId: string, roleId: string): SkillStudioRole | undefined {
  return findIndustry(industryId)?.roles.find((r) => r.id === roleId);
}
