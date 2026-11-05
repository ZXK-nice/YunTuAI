import type { CatalogModel } from "../../types/model";
import { AUTO_MODEL_ID } from "../../types/model";
import { getCatalogModel } from "./catalog";
import { getRuntimeDefaultModelId } from "./runtime-default-model";

/** 详情区焦点：具体模型、Auto 模式，或无（显示占位文案）。 */
export type ModelDetailFocus = CatalogModel | "auto" | null;

export function autoModelDetailLines(defaultModelLabel: string): string[] {
  return [
    `日常对话与办公任务优先使用默认模型（当前 ${defaultModelLabel}）。`,
    "上传图片时：多模态模型直传视觉；纯文本模型走内置 OCR。",
    "需要固定某模型时，在下方列表中手动选择即可。",
  ];
}

/** 打开菜单或离开列表区时的默认详情焦点。 */
export function resolveDefaultDetailFocus(selectionId: string): ModelDetailFocus {
  if (selectionId === AUTO_MODEL_ID) return "auto";
  return getCatalogModel(selectionId) ?? null;
}

export function resolveDetailFocus(
  hovered: ModelDetailFocus,
  selectionId: string,
): ModelDetailFocus {
  if (hovered === "auto") return "auto";
  if (hovered) return hovered;
  return resolveDefaultDetailFocus(selectionId);
}

/** @deprecated use resolveDefaultDetailFocus */
export function resolveDefaultDetailModel(selectionId: string): CatalogModel | null {
  const focus = resolveDefaultDetailFocus(selectionId);
  return focus === "auto" || focus === null ? null : focus;
}

/** @deprecated use resolveDetailFocus */
export function resolveDetailModel(
  hovered: CatalogModel | null,
  selectionId: string,
): CatalogModel | null {
  const focus = resolveDetailFocus(hovered, selectionId);
  return focus === "auto" || focus === null ? null : focus;
}

export function defaultModelLabel(): string {
  const id = getRuntimeDefaultModelId();
  return getCatalogModel(id)?.label ?? id;
}
