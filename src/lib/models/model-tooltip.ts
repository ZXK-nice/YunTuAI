import type { CatalogModel } from "../../types/model";
import { formatContextLabel } from "./context-label";

export function formatModelTooltipLines(model: CatalogModel): string[] {
  const t = model.tooltip;
  if (!t) return [model.label];
  const lines = [t.strengths];
  if (model.contextTokens) {
    const ctxNote =
      model.provider === "qwen"
        ? "（百炼标称最大输入约 992K tokens）"
        : model.provider === "deepseek"
          ? "（以 DeepSeek 网关配置为准）"
          : model.provider === "mimo"
            ? "（以小米 MiMo 开放平台为准）"
            : "";
    lines.push(`上下文：${formatContextLabel(model.contextTokens)}${ctxNote}`);
  }
  const price = `输入 ¥${t.inputPricePerMillionCny}/百万 tokens · 输出 ¥${t.outputPricePerMillionCny}/百万 tokens`;
  lines.push(t.priceNote ? `${price}（${t.priceNote}）` : price);
  const media: string[] = [];
  media.push(t.supportsImage ? "图片：支持（直连视觉，不走 OCR）" : "图片：不支持（附件走内置 OCR）");
  media.push(t.supportsVideo ? "视频：支持" : "视频：不支持");
  lines.push(media.join(" · "));
  return lines;
}

/** 预览条第二行：价格与多模态能力（单行）。 */
export function formatModelPreviewMeta(model: CatalogModel): string {
  const t = model.tooltip;
  if (!t) return "";
  const price = `输入 ¥${t.inputPricePerMillionCny} · 输出 ¥${t.outputPricePerMillionCny}/百万 tokens`;
  const img = t.supportsImage ? "支持图片" : "图片走 OCR";
  const vid = t.supportsVideo ? "支持视频" : "";
  return [price, img, vid].filter(Boolean).join(" · ");
}
