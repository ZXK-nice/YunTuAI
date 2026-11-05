import { DEFAULT_MODEL_ID } from "../../types/model";

let runtimeDefaultModelId = DEFAULT_MODEL_ID;

/** Auto / 视觉回退使用的当前默认短 id（随已配置厂商 Key 更新）。 */
export function setRuntimeDefaultModelId(modelId: string): void {
  const next = modelId.trim();
  if (!next) return;
  runtimeDefaultModelId = next;
}

export function getRuntimeDefaultModelId(): string {
  return runtimeDefaultModelId;
}

export function resetRuntimeDefaultModelIdForTest(): void {
  runtimeDefaultModelId = DEFAULT_MODEL_ID;
}
