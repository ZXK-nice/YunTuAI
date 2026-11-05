import type { MessageFileEntry } from "./message-files";
import type { PendingChatAttachment } from "./message-files";
import type { SessionsSendAttachment } from "../openclaw/session-rpc";
import {
  buildDirectImageOcrContext,
  buildOfficeAttachmentBundle,
} from "./office-attachments";
import { buildVisionAttachmentsForSend } from "./vision-attachments";
import { findLegacyOfficeNames, legacyOfficeUserMessage } from "./office-legacy-formats";
import { chatGetOutputDir } from "./chat-files-bridge";
import { SEND_PROGRESS } from "./send-progress";

export type ChatAttachmentPrepInput = {
  trimmed: string;
  attachedFiles: MessageFileEntry[];
  batchId: string;
  textFiles: Array<PendingChatAttachment & { kind: "text"; content: string }>;
  hasContextCards: boolean;
  fileNames: string;
  localDisplay: string;
  /** 当前模型支持直连视觉时跳过 OCR，改走 vision attachments */
  useDirectVision?: boolean;
};

export type ChatAttachmentPrepResult = {
  remotePayload: string;
  ocrCount: number;
  imageOnlyPptx: boolean;
  visionAttachments?: SessionsSendAttachment[];
  toast?: { message: string; variant: "info" | "warning" };
};

/** 办公附件预提取 + 图片 OCR，从 ChatPanel 发送流程拆出。 */
export async function prepareChatAttachmentPayload(
  input: ChatAttachmentPrepInput,
  setSendProgress: (label: string) => void,
): Promise<ChatAttachmentPrepResult> {
  const { trimmed, attachedFiles, batchId, textFiles, fileNames, localDisplay, useDirectVision } =
    input;

  const legacyNames = findLegacyOfficeNames(attachedFiles.map((f) => f.name));
  if (legacyNames.length > 0) {
    throw new Error(legacyOfficeUserMessage(legacyNames[0]!));
  }

  let remotePayload = trimmed;
  let imageOnlyPptx = false;

  if (attachedFiles.length === 0) {
    return {
      remotePayload: remotePayload || localDisplay,
      ocrCount: 0,
      imageOnlyPptx: false,
    };
  }

  const outDir = await chatGetOutputDir().catch(() => null);
  try {
    setSendProgress(SEND_PROGRESS.EXTRACTING_DOCS);
    const officeBundle = await buildOfficeAttachmentBundle(attachedFiles, batchId, {
      skipOcr: useDirectVision,
    });

    let visionAttachments: SessionsSendAttachment[] | undefined;
    let imageOcr = { context: "", imageCount: 0 };

    if (useDirectVision) {
      setSendProgress(SEND_PROGRESS.RECOGNIZING_IMAGES);
      visionAttachments = await buildVisionAttachmentsForSend(
        attachedFiles,
        officeBundle.slideImagePaths,
      );
    } else {
      setSendProgress(SEND_PROGRESS.RECOGNIZING_IMAGES);
      imageOcr = await buildDirectImageOcrContext(attachedFiles, (current, total) => {
        setSendProgress(`正在 OCR 识别（${current}/${total}）`);
      });
    }

    const ocrCount = useDirectVision ? 0 : officeBundle.ocrImageCount + imageOcr.imageCount;
    imageOnlyPptx = officeBundle.imageOnlyPptx;

    const ctxLines = [
      `用户附件位于 workspace/inbox/${batchId}/：${fileNames}`,
      outDir ? `请将处理结果保存到：${outDir}` : "",
    ].filter(Boolean);
    const ctx = ctxLines.join("\n");
    remotePayload = trimmed
      ? `${trimmed}\n\n---\n[文件上下文]\n${ctx}`
      : `请阅读并处理用户上传的附件（${fileNames}）。\n\n---\n[文件上下文]\n${ctx}`;
    if (officeBundle.extraContext) {
      remotePayload += `\n\n---\n[文档预提取]\n${officeBundle.extraContext}`;
    }
    if (!useDirectVision && imageOcr.context) {
      remotePayload += `\n\n---\n[图片 OCR 预识别]\n${imageOcr.context}`;
    }
    if (textFiles.length > 0) {
      const large = textFiles.some((f) => f.content.length > 6000);
      remotePayload += large
        ? "\n（大文本附件已按路径引用写入 USER.md，请读取 workspace/inbox 下完整文件）"
        : "\n（文本类附件内容亦已写入 USER.md 供参考）";
    }

    const visionCount = visionAttachments?.length ?? 0;
    const toast =
      useDirectVision && visionCount > 0
        ? {
            message: `已附带 ${visionCount} 张图片，将由多模态模型直接理解（不走 OCR）`,
            variant: "info" as const,
          }
        : ocrCount > 0
          ? { message: `已通过内置 OCR 识别 ${ocrCount} 张图片`, variant: "info" as const }
          : imageOnlyPptx && useDirectVision
            ? {
                message: "该 PPT 为图片幻灯片，将由多模态模型直接理解（不走 OCR）",
                variant: "info" as const,
              }
            : imageOnlyPptx
              ? { message: "该 PPT 为图片幻灯片，正在尝试 OCR 识别", variant: "info" as const }
              : undefined;

    return { remotePayload, ocrCount, imageOnlyPptx, visionAttachments, toast };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const friendly =
      /ocr|tesseract|tessdata/i.test(raw)
        ? "图片 OCR 未完成，将仅发送文件路径，Agent 仍可读取原图"
        : /office|pptx|docx|xlsx|csv|pdf|extract/i.test(raw)
          ? "文档预提取未完成，将仅发送文件路径，Agent 仍可直接读取原文件"
          : "附件预处理未完成，将仅发送文件路径";
    const ctxLines = [
      `用户附件位于 workspace/inbox/${batchId}/：${fileNames}`,
      outDir ? `请将处理结果保存到：${outDir}` : "",
    ].filter(Boolean);
    const ctx = ctxLines.join("\n");
    remotePayload = trimmed
      ? `${trimmed}\n\n---\n[文件上下文]\n${ctx}`
      : `请阅读并处理用户上传的附件（${fileNames}）。\n\n---\n[文件上下文]\n${ctx}`;
    return {
      remotePayload,
      ocrCount: 0,
      imageOnlyPptx: false,
      toast: { message: friendly, variant: "warning" },
    };
  }
}
