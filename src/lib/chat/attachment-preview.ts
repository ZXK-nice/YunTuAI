import { isImageFileName } from "./vision-attachments";
import type { PendingChatAttachment } from "./message-files";
import {
  chatExtractOfficeContext,
  chatOcrImagePaths,
} from "./chat-files-bridge";

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

function countChars(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 仅真正在跑 OCR/预读时禁止发送；`pending` 表示发送时再识别，可发。 */
export function isAttachmentExtractBlockingSend(
  status: PendingChatAttachment["extractStatus"] | undefined,
): boolean {
  return status === "extracting";
}

const ATTACHED_HINT = {
  extractStatus: "office_ok" as const,
  extractHint: "已加入附件",
};

/** 拖入附件后本地预提取 / OCR，供输入区状态提示。 */
export async function enrichPendingAttachmentPreview(
  att: PendingChatAttachment,
): Promise<Pick<PendingChatAttachment, "extractStatus" | "extractHint">> {
  if (!att.path?.trim()) {
    if (isImageFileName(att.name)) {
      return {
        extractStatus: "pending",
        extractHint: "发送时将识别图中文字",
      };
    }
    if (isOfficeDocumentName(att.name)) {
      return {
        extractStatus: "pending",
        extractHint: "发送时将预读文档",
      };
    }
    return ATTACHED_HINT;
  }

  const path = att.path.trim();

  if (isImageFileName(att.name)) {
    const batch = await chatOcrImagePaths([path]);
    const row = batch?.[0];
    if (!row) {
      return { extractStatus: "ocr_fail", extractHint: "识别失败，请换清晰图" };
    }
    if (row.ok && row.text.trim()) {
      const n = countChars(row.text);
      return {
        extractStatus: "ocr_ok",
        extractHint: n > 0 ? `已识别出约 ${n} 字` : "已识别出文字",
      };
    }
    return {
      extractStatus: "ocr_empty",
      extractHint: "未识别到文字，建议换清晰图",
    };
  }

  if (isOfficeDocumentName(att.name)) {
    const batchId = `preview-${att.id}`;
    const extracted = await chatExtractOfficeContext(path, batchId);
    if (!extracted) {
      return { extractStatus: "office_fail", extractHint: "预读失败，发送后重试" };
    }
    const ocrText = extracted.ocrPreview.trim();
    const textPreview = extracted.textPreview.trim();
    if (ocrText) {
      const n = countChars(ocrText);
      return {
        extractStatus: "ocr_ok",
        extractHint: n > 0 ? `已识别出约 ${n} 字` : "已识别出文字",
      };
    }
    if (textPreview) {
      return { extractStatus: "office_ok", extractHint: "已预读文档内容" };
    }
    if (extracted.imageOnly) {
      return {
        extractStatus: "ocr_empty",
        extractHint: "纯图片文档，建议换清晰图",
      };
    }
    return { extractStatus: "office_ok", extractHint: "已读取附件" };
  }

  return ATTACHED_HINT;
}
