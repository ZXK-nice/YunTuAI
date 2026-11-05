/**
 * 办公文件与自动化任务：附件分类、Agent 执行契约、任务计划分支。
 * 用户主场景是 Excel/Word/PPT/CSV 处理与批处理自动化，内核必须优先本地预提取而非让 Agent 瞎装依赖。
 */
import type { MessageFileEntry } from "./message-files";

export type OfficeAttachmentKind =
  | "spreadsheet"
  | "document"
  | "presentation"
  | "csv"
  | "pdf"
  | "image";

export function classifyOfficeAttachment(fileName: string): OfficeAttachmentKind | null {
  const lower = fileName.trim().toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  if (/\.(xlsx|xlsm|xls|ods)$/.test(lower)) return "spreadsheet";
  if (/\.csv$/.test(lower)) return "csv";
  if (/\.(docx|doc|wps|rtf|odt)$/.test(lower)) return "document";
  if (/\.(pptx|ppt|odp)$/.test(lower)) return "presentation";
  if (/\.pdf$/.test(lower)) return "pdf";
  return null;
}

export function summarizeOfficeAttachments(files: Pick<MessageFileEntry, "name">[]): OfficeAttachmentKind[] {
  const kinds = new Set<OfficeAttachmentKind>();
  for (const f of files) {
    const k = classifyOfficeAttachment(f.name);
    if (k) kinds.add(k);
  }
  return [...kinds];
}

export function hasOfficeOrAutomationAttachments(files: Pick<MessageFileEntry, "name">[]): boolean {
  return summarizeOfficeAttachments(files).length > 0;
}

/** Agent 处理办公附件时的硬性约定（注入发送 payload）。 */
export const OFFICE_EXECUTION_CONTRACT = `

---
【云图·办公文件处理·执行契约】
1. 消息中 **[文档预提取] / [表格预提取] / [图片 OCR 预识别]** 为软件已完成的本地解析，**必须优先使用**；勿重复安装 Python/npm/pip 包（本机通常无 Python，npm 可能被策略拦截）。
2. 处理 Excel/Word/PPT/CSV：**禁止**依赖 pandas/openpyxl 等未内置库；应基于预提取文本完成整理，产出写入用户 \`output\` 目录。
3. **内置写回**（优先，无需 pip/PowerShell）：在回复末尾用围栏输出一份 JSON，软件会自动写成文件。xlsx/csv 用 \`rows\`（二维字符串数组）；docx 用 \`paragraphs\`（字符串数组）。不要把整表再贴进正文。
\`\`\`yuntu-office-write
{"format":"xlsx","filename":"结果.xlsx","rows":[["列1","列2"],["a","b"]]}
\`\`\`
4. 仅当围栏无法使用时，才用安装目录 \`bundled\\support\\yuntu-office-write.ps1\`。**禁止**自行 pip/npm 安装 openpyxl/pandas 等库。
5. **产出**：正文只写文件名与路径（各一行）+ 1～3 条结论，勿复述处理过程。
6. **自动化/批处理**：先小样本验证再全量；删除/覆盖/外发前说明并确认。`;

export const AUTOMATION_EXECUTION_CONTRACT = `

---
【云图·自动化任务·执行契约】
1. 拆分为可验收步骤；每步失败时换路径（换命令、拆文件、缩小范围），不要无限重试同一失败命令。
2. 定时/批处理类任务：给出可重复执行的脚本或操作清单，并说明如何在本机再次运行。
3. 完成后交付：产出路径 + 验收清单（通过/未通过项）。`;

export function officeKindsLabel(kinds: OfficeAttachmentKind[]): string {
  const map: Record<OfficeAttachmentKind, string> = {
    spreadsheet: "表格",
    document: "文档",
    presentation: "演示",
    csv: "CSV",
    pdf: "PDF",
    image: "图片",
  };
  return kinds.map((k) => map[k]).join("、");
}
