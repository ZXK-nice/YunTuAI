import { PRODUCT_NAME } from "../product-brand";

/** 快捷任务模板：结构化 prompt + 能力调度提示。 */

export type TaskTemplateIcon =
  | "doc"
  | "search"
  | "table"
  | "mail"
  | "chart"
  | "translate"
  | "slides"
  | "meeting"
  | "ocr";

export type TaskTemplate = {
  /** 稳定 id，写入 local_tasks.template_id */
  id: string;
  label: string;
  icon: TaskTemplateIcon;
  /** 用户可见的简短目标 */
  goal: string;
  /** 发送给 Agent 的完整指令（由 buildTaskTemplatePrompt 生成） */
  promptBody: string;
  /** 希望写入的产出类型提示 */
  outputHint?: string;
  /** 推荐技能目录名（若已预装则提示 Agent 使用） */
  preferredSkills?: string[];
};

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: "customer-doc",
    label: "客户文档",
    icon: "doc",
    goal: "创建专业客户介绍文档",
    promptBody:
      "请帮我创建一份专业的客户介绍文档（Markdown）。先列出大纲，再逐节撰写；若有不确定信息用【待补充】标注，并说明需要我提供什么。",
    outputHint: "将最终 Markdown 保存到输出目录，文件名含客户主题。",
    preferredSkills: ["full-output-enforcement"],
  },
  {
    id: "web-research",
    label: "网络调研",
    icon: "search",
    goal: "网络调研并整理结论",
    promptBody:
      "请针对我接下来描述的主题做网络调研：列出 3–5 个可靠信息源、关键结论、以及仍需验证的疑点。若需我补充主题，请先简短提问。",
    outputHint: "将调研纪要保存为 Markdown 到输出目录。",
  },
  {
    id: "excel-table",
    label: "Excel 表格",
    icon: "table",
    goal: "生成可导入 Excel 的表格",
    promptBody:
      "请根据我的需求生成可导入 Excel 的 CSV 表格：先确认列名与示例行，再输出完整 CSV（用代码块包裹）。说明每列含义。",
    outputHint: "将 CSV 文件写入输出目录，便于直接用 Excel 打开。",
  },
  {
    id: "biz-email",
    label: "商务邮件",
    icon: "mail",
    goal: "撰写商务邮件",
    promptBody:
      "请帮我写一封简洁专业的商务邮件。先确认收件人关系、目的与语气（正式/友好），再给出主题行与正文；提供中英文两个版本。",
  },
  {
    id: "data-analysis",
    label: "数据分析",
    icon: "chart",
    goal: "分析数据并给建议",
    promptBody:
      "请分析我提供的数据或描述：给出关键指标、趋势、异常点与可执行建议。若缺数据，请列出最少需要哪些字段。",
    outputHint: "若生成图表说明或汇总表，请写入输出目录。",
  },
  {
    id: "bilingual-translate",
    label: "中英翻译",
    icon: "translate",
    goal: "中英互译",
    promptBody:
      "请将以下内容在中英之间互译，保持专业术语一致；先判断源语言，再给出译文，并标注不易直译处及替代表达。",
    preferredSkills: ["bilingual-pdf-translation"],
  },
  {
    id: "ppt-outline",
    label: "PPT 大纲",
    icon: "slides",
    goal: "制作 PPT 大纲",
    promptBody:
      "请为我的主题制作 PPT 大纲：封面标题、3–5 个章节、每节 3–4 个要点与建议配图说明；总页数控制在 12 页以内。",
    outputHint: "将大纲保存为 Markdown 到输出目录。",
  },
  {
    id: "meeting-notes",
    label: "会议纪要",
    icon: "meeting",
    goal: "整理会议纪要",
    promptBody:
      "请根据我提供的会议记录或要点，整理会议纪要：时间/参会人（可留空）、决议、待办（负责人+截止日期占位）、未决问题。",
    outputHint: "将纪要 Markdown 写入输出目录。",
  },
  {
    id: "image-ocr",
    label: "图片 OCR",
    icon: "ocr",
    goal: "提取图片文字",
    promptBody:
      "请提取我上传图片中的文字，按阅读顺序输出；保留段落结构；对不确定字符用【?】标注，并说明图片质量是否影响识别。",
    outputHint: "将识别文本保存到输出目录，便于后续编辑。",
  },
];

export const TASK_TEMPLATE_GROUP_SIZE = 3;

/** 空态固定快捷入口（不轮换）。 */
export const OFFICE_QUICK_START_TEMPLATES: TaskTemplate[] = [
  {
    id: "excel-organize",
    label: "整理 Excel",
    icon: "table",
    goal: "整理 Excel 表格",
    promptBody:
      "请根据我上传的表格或描述的需求整理 Excel：去重、汇总、按列计算、格式化。优先使用消息中的【表格预提取】内容，勿安装 Python/npm 依赖。",
    outputHint: "将整理后的 xlsx 保存到输出目录，文件名体现任务主题。",
  },
  {
    id: "image-ocr",
    label: "读图出字",
    icon: "ocr",
    goal: "提取图片文字",
    promptBody:
      "请提取我上传图片中的文字，按阅读顺序输出；保留段落结构；对不确定字符用【?】标注，并说明图片质量是否影响识别。",
    outputHint: "将识别文本保存到输出目录，便于后续编辑。",
  },
  {
    id: "word-draft",
    label: "写 Word",
    icon: "doc",
    goal: "撰写 Word 文档",
    promptBody:
      "请根据我的需求撰写 Word 文档：先确认结构与要点，再输出完整正文。若有不确定信息用【待补充】标注。",
    outputHint: "将 docx 保存到输出目录，文件名体现文档主题。",
    preferredSkills: ["full-output-enforcement"],
  },
];

/** 组装带 YunTuAI 调度上下文的完整发送文案。 */
export function buildTaskTemplatePrompt(
  template: TaskTemplate,
  opts?: { outputDir?: string | null },
): string {
  const parts = [
    `【${PRODUCT_NAME} 办事任务】${template.goal}`,
    "",
    template.promptBody,
  ];

  if (template.preferredSkills?.length) {
    parts.push(
      "",
      `【能力提示】优先使用已预装技能：${template.preferredSkills.join("、")}（若当前环境可用）。`,
    );
  }

  if (template.outputHint) {
    parts.push("", `【产出要求】${template.outputHint}`);
  }

  const out = opts?.outputDir?.trim();
  if (out) {
    parts.push("", `【输出目录】请将最终文件保存到：${out}`);
  }

  parts.push("", "完成后请简要说明产出文件路径；若无法落盘，直接在回复中给出完整内容。");
  return parts.join("\n");
}

export function taskTemplateGroups(): TaskTemplate[][] {
  const groups: TaskTemplate[][] = [];
  for (let i = 0; i < TASK_TEMPLATES.length; i += TASK_TEMPLATE_GROUP_SIZE) {
    groups.push(TASK_TEMPLATES.slice(i, i + TASK_TEMPLATE_GROUP_SIZE));
  }
  return groups;
}
