/** 与 Rust `openclaw_skill_bootstrap::CURATED_SKILL_DIRS` 保持一致 */
export const CURATED_SKILL_ENTRIES = [
  { id: "bilingual-pdf-translation", label: "双语 PDF 翻译", desc: "技术规格 PDF 英→中对照排版" },
  { id: "full-output-enforcement", label: "完整输出", desc: "抑制截断，保证交付完整" },
  { id: "paper-to-patent", label: "论文转专利", desc: "论文→中国发明专利初稿（证据台账）" },
  { id: "scipilot-writing", label: "SciPilot 学术写作", desc: "论文润色、章节起草、去 AI 味与审稿自检" },
  { id: "scipilot-cite", label: "SciPilot 引用", desc: "文献检索、引用格式化与防幻觉校验" },
  { id: "anti-vibe-writing", label: "去 AI 味写作", desc: "中英文文稿人性化润色，去除模板腔" },
  { id: "skills-best-practices", label: "技能编写最佳实践", desc: "按 agentskills 规范撰写高质量技能" },
  { id: "skill-development", label: "技能开发指南", desc: "Anthropic 官方技能结构与渐进式披露" },
  { id: "desktop-control", label: "桌面控制", desc: "Windows 截图、键鼠与图像定位自动化" },
  { id: "tyc-it", label: "天眼查企业查询", desc: "企业背调、股权风险、司法与经营真实性" },
  { id: "browser-use", label: "浏览器自动化", desc: "网页导航、填表、截图与数据抓取" },
  { id: "kret-rag-kb", label: "KRET 知识库检索", desc: "局域网文档检索，需先在设置中启用知识库助手" },
] as const;

export const CURATED_SKILL_IDS = new Set(CURATED_SKILL_ENTRIES.map((s) => s.id));
