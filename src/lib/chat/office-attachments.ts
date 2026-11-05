import type { MessageFileEntry } from "./message-files";
import {
  chatExtractOfficeContext,
  chatOcrImagePaths,
  chatReadTextPreview,
  type OcrImageResult,
  type OfficeExtractResult,
} from "./chat-files-bridge";
import {
  MAX_OFFICE_EXTRACT_IMAGES,
  MAX_VISION_ATTACHMENTS_PER_SEND,
} from "./attachment-limits";
import { isImageFileName } from "./vision-attachments";

const CSV_PREVIEW_MAX_BYTES = 512 * 1024;

function isOpenDocumentNeedConvert(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".odt") ||
    lower.endsWith(".odp") ||
    lower.endsWith(".ods") ||
    lower.endsWith(".wps")
  );
}

function isOfficeDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".pdf")
  );
}

function humanizeOcrFailure(error: string): string {
  const e = error.trim();
  if (!e) return "未能识别文字";
  if (/tesseract|tessdata|chi_sim|eng\.traineddata/i.test(e)) {
    return "内置 OCR 引擎或语言包不可用";
  }
  if (/timeout|超时/i.test(e)) return "识别超时";
  if (/permission|access|denied|eacces/i.test(e)) return "无权限读取图片";
  if (/not found|enoent|找不到/i.test(e)) return "图片文件不存在";
  // 不把底层英文堆栈塞进发给 Agent 的上下文
  return e.length > 80 ? `${e.slice(0, 77)}…` : e;
}

export function formatOcrResults(results: OcrImageResult[]): string {
  const blocks: string[] = [];
  for (const [idx, item] of results.entries()) {
    if (item.ok && item.text.trim()) {
      blocks.push(`【OCR 第${idx + 1}张 · ${item.name} · ${item.engine}】\n${item.text.trim()}`);
    } else if (item.error) {
      blocks.push(`【OCR 第${idx + 1}张 · ${item.name}】未能识别：${humanizeOcrFailure(item.error)}`);
    }
  }
  return blocks.join("\n\n");
}

export function formatOfficeExtractContext(
  result: OfficeExtractResult,
  fileName: string,
  opts?: { omitOcr?: boolean },
): string {
  const lines = [`文件：${fileName}`, `类型：${result.kind.toUpperCase()}`];
  if (result.kind === "xlsx" && result.slideCount > 0) {
    lines.push(`工作表数：${result.slideCount}`);
  } else if (result.kind === "pdf" && result.slideCount > 0) {
    lines.push(`页数（约）：${result.slideCount}`);
  } else if (result.slideCount > 0) {
    lines.push(`页数：${result.slideCount}`);
  }
  if (result.textPreview.trim()) {
    const label =
      result.kind === "xlsx" || result.kind === "xls"
        ? "【表格预提取】"
        : result.kind === "pdf"
          ? "【PDF 预提取】"
          : "【提取正文】";
    lines.push("", label, result.textPreview.trim());
  }
  if (!opts?.omitOcr && result.ocrPreview.trim()) {
    lines.push("", "【OCR 预识别】", result.ocrPreview.trim());
  }
  if (result.imagePaths.length > 0) {
    const shown = Math.min(result.imagePaths.length, MAX_OFFICE_EXTRACT_IMAGES);
    const visionCap = MAX_VISION_ATTACHMENTS_PER_SEND;
    const exportLabel =
      result.kind === "pdf"
        ? `【PDF 页图】已导出 ${shown} 张到工作区（workspace/inbox/.../_pdf_pages/）：`
        : `【幻灯片图片】已导出 ${shown} 张到工作区（workspace/inbox/.../_ppt_slides/）：`;
    lines.push(
      "",
      exportLabel,
      ...result.imagePaths.slice(0, shown).map((p, i) => `${i + 1}. ${p}`),
    );
    if (result.imagePaths.length > visionCap && opts?.omitOcr) {
      const capNote =
        result.kind === "pdf"
          ? `说明：共 ${result.imagePaths.length} 张 PDF 页图，多模态发送时最多附带前 ${visionCap} 张。`
          : `说明：共 ${result.imagePaths.length} 张幻灯片图片，多模态发送时最多附带前 ${visionCap} 张。`;
      lines.push("", capNote);
    }
  }
  if (result.imageOnly && result.kind === "pdf" && !opts?.omitOcr) {
    lines.push(
      "",
      result.ocrPreview.trim()
        ? "说明：该 PDF 为扫描件（无可用文本层），正文已通过内置 OCR 预识别注入上文。"
        : "说明：该 PDF 为扫描件（无可用文本层），内置 OCR 未识别到文字。",
    );
  }
  if (result.imageOnly && (result.kind === "pptx" || result.kind === "ppt") && !opts?.omitOcr) {
    lines.push(
      "",
      result.ocrPreview.trim()
        ? "说明：该 PPT 为纯图片幻灯片（无可用文本层），正文已通过内置 OCR 预识别注入上文。"
        : "说明：该 PPT 为纯图片幻灯片（无可用文本层），内置 OCR 未识别到文字。",
    );
  }
  if (result.imageOnly && opts?.omitOcr) {
    lines.push(
      "",
      result.kind === "pdf"
        ? "说明：该 PDF 为扫描件；当前为多模态模型，页图将随消息以视觉附件发送（不走 OCR）。"
        : "说明：该 PPT 为纯图片幻灯片；当前为多模态模型，幻灯片图片将随消息以视觉附件发送（不走 OCR）。",
    );
  }
  return lines.join("\n");
}

function formatCsvPreviewContext(
  preview: { name: string; content: string; truncated: boolean },
  fileName: string,
): string {
  const lines = [`文件：${fileName}`, "类型：CSV"];
  if (preview.content.trim()) {
    lines.push("", "【表格预提取】", preview.content.trim());
  }
  if (preview.truncated) {
    lines.push("", "说明：CSV 预览已截断，完整内容见 workspace/inbox 原文件。");
  }
  return lines.join("\n");
}

export type OfficeAttachmentBundle = {
  extraContext: string;
  ocrImageCount: number;
  imageOnlyPptx: boolean;
  /** PPT 导出的幻灯片图片路径（多模态直传用） */
  slideImagePaths: string[];
};

/** 对 PPTX/DOCX/XLSX 做本地预提取（含幻灯片 OCR，多模态时可跳过 OCR 文本注入）。 */
export async function buildOfficeAttachmentBundle(
  files: MessageFileEntry[],
  batchId: string,
  opts?: { skipOcr?: boolean },
): Promise<OfficeAttachmentBundle> {
  const blocks: string[] = [];
  let imageOnlyPptx = false;
  let ocrImageCount = 0;
  const slideImagePaths: string[] = [];

  for (const file of files) {
    if (isOpenDocumentNeedConvert(file.name)) {
      blocks.push(
        `文件：${file.name}\n说明：该格式请另存为 docx/pptx/xlsx 后上传，以便本地预提取。`,
      );
      continue;
    }
    if (!isOfficeDocumentName(file.name)) continue;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".csv")) {
      try {
        const preview = await chatReadTextPreview(file.path, CSV_PREVIEW_MAX_BYTES);
        if (preview?.content.trim()) {
          blocks.push(formatCsvPreviewContext(preview, file.name));
          continue;
        }
      } catch {
        /* fall through to path-only note */
      }
      blocks.push(
        `文件：${file.name}\n类型：CSV\n说明：CSV 预读取失败，请 Agent 用 Node/Shell 读取 inbox 下 UTF-8 原文件（勿安装 Python 依赖）。`,
      );
      continue;
    }
    try {
      const extracted = await chatExtractOfficeContext(file.path, batchId, {
        skipOcr: opts?.skipOcr,
      });
      if (!extracted) {
        blocks.push(
          `文件：${file.name}\n说明：文档预提取暂不可用（本机服务未响应）。请基于 inbox 原文件处理；勿安装 pip/npm 依赖。`,
        );
        continue;
      }
      blocks.push(formatOfficeExtractContext(extracted, file.name, { omitOcr: opts?.skipOcr }));
      if (extracted.imageOnly) imageOnlyPptx = true;
      if (!opts?.skipOcr && extracted.ocrPreview.trim() && extracted.imagePaths.length > 0) {
        ocrImageCount += extracted.imagePaths.length;
      }
      if (extracted.imagePaths.length > 0) {
        slideImagePaths.push(...extracted.imagePaths);
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const hint = raw.trim().slice(0, 160);
      blocks.push(
        `文件：${file.name}\n说明：文档预提取失败${hint ? `（${hint}）` : ""}。请基于 inbox 原文件处理；勿安装 pip/npm 依赖，优先 read/exec 本机工具。`,
      );
    }
  }

  return {
    extraContext: blocks.join("\n\n"),
    ocrImageCount,
    imageOnlyPptx,
    slideImagePaths,
  };
}

/** 对直接附带的图片执行内置 OCR（逐张识别并报告进度）。 */
export async function buildDirectImageOcrContext(
  files: MessageFileEntry[],
  onProgress?: (current: number, total: number) => void,
): Promise<{
  context: string;
  imageCount: number;
}> {
  const imagePaths = files.filter((f) => isImageFileName(f.name)).map((f) => f.path);
  if (imagePaths.length === 0) {
    return { context: "", imageCount: 0 };
  }
  onProgress?.(1, imagePaths.length);
  const batch = await chatOcrImagePaths(imagePaths);
  if (!batch?.length) {
    return {
      context:
        "【图片 OCR 预识别】\n未能完成识别（本机 OCR 暂不可用）。请 Agent 读取 inbox 原图路径处理。",
      imageCount: 0,
    };
  }
  const okCount = batch.filter((item) => item.ok && item.text.trim().length > 0).length;
  const formatted = formatOcrResults(batch);
  if (!formatted.trim() || okCount === 0) {
    return { context: "", imageCount: 0 };
  }
  return {
    context: formatted,
    imageCount: okCount,
  };
}
