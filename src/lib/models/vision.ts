import { getCatalogModel, modelUsesDirectVision, RELAY_MODEL_CATALOG } from "./catalog";
import { getRuntimeDefaultModelId } from "./runtime-default-model";

/** 中转站默认视觉回退模型（与 openclaw.json imageModel 种子一致）。 */
export const DEFAULT_VISION_MODEL_ID = "gpt-5.5";

export function modelSupportsVision(modelId: string): boolean {
  return modelUsesDirectVision(modelId);
}

export function pickVisionCapableModelId(preferred?: string): string {
  if (preferred && modelSupportsVision(preferred)) return preferred;
  const fromCatalog = RELAY_MODEL_CATALOG.find((m) => m.capabilities?.includes("vision"));
  return fromCatalog?.id ?? DEFAULT_VISION_MODEL_ID;
}

export function visionHintForSelection(selectionId: string): string | null {
  const resolved = selectionId === "auto" ? getRuntimeDefaultModelId() : selectionId;
  if (modelSupportsVision(resolved)) return null;
  const pick = pickVisionCapableModelId();
  const label = getCatalogModel(pick)?.label ?? pick;
  return `已附带图片，将使用视觉模型「${label}」理解画面（主对话模型仍为 ${getCatalogModel(resolved)?.label ?? resolved}）。`;
}
