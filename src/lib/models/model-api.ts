/**
 * 模型选择对接层：前端偏好 +（可选）同步至本机 OpenClaw 配置。
 * 中转站全量模型列表以 catalog 为准；后端 OpenClaw 逐步对接时可扩展 sync。
 */
import { getItem, setItem } from "../safeStorage";
import { isTauriRuntime } from "../tauri-env";
import { fetchAvailableModels, fetchCurrentModel, setModel } from "../openclaw/env-bridge";
import { AUTO_MODEL_ID, type ModelSelectionId, type ModelSwitchResult } from "../../types/model";
import {
  displayLabelForSelection,
  getCatalogModel,
  resolveSelectionToModelId,
} from "./catalog";
import { getRuntimeDefaultModelId } from "./runtime-default-model";

const STORAGE_KEY = "yuntuai:model-selection";

export function readPersistedSelection(): ModelSelectionId {
  const raw = getItem(STORAGE_KEY)?.trim();
  if (!raw) return AUTO_MODEL_ID;
  if (raw === "auto") return "auto";
  const known = getCatalogModel(raw);
  if (known) return known.id;
  return AUTO_MODEL_ID;
}

export function persistSelection(selectionId: ModelSelectionId): void {
  setItem(STORAGE_KEY, selectionId);
}

export function getResolvedModelId(selectionId: ModelSelectionId): string {
  return resolveSelectionToModelId(selectionId);
}

export function getSelectionDisplayLabel(selectionId: ModelSelectionId): string {
  return displayLabelForSelection(selectionId);
}

/** 启动时从本机 OpenClaw 读取已配置模型，与本地偏好对齐（若后端有值则优先后端）。 */
export async function pullBackendModelSelection(): Promise<ModelSelectionId | null> {
  if (!isTauriRuntime()) return null;
  const current = await fetchCurrentModel().catch(() => null);
  if (!current?.trim()) return null;
  const short = current.includes("/") ? current.split("/").pop()! : current;
  if (short === "auto") return "auto";
  const known = getCatalogModel(short);
  if (known) return known.id;
  return short;
}

async function trySyncToOpenClaw(resolvedModelId: string): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const available = await fetchAvailableModels().catch(() => []);
  const supported = new Set(available.map((m) => m.id));
  if (!supported.has(resolvedModelId)) {
    const profile = await import("../openclaw/env-bridge").then((m) => m.fetchDistributionProfile());
    if (profile && profile.profile !== "relay-station" && getCatalogModel(resolvedModelId)) {
      await setModel(resolvedModelId);
      return true;
    }
    return false;
  }
  await setModel(resolvedModelId);
  return true;
}

/**
 * 切换模型：持久化偏好，并在当前发行档支持时写入 openclaw.json。
 */
export async function switchModel(selectionId: ModelSelectionId): Promise<ModelSwitchResult> {
  const resolvedModelId = getResolvedModelId(selectionId);
  persistSelection(selectionId);

  let backendSynced = false;
  let message: string | undefined;

  if (selectionId === "auto") {
    message = `已启用 Auto，将优先使用 ${getCatalogModel(getRuntimeDefaultModelId())?.label ?? getRuntimeDefaultModelId()}`;
  } else {
    message = `已切换为 ${displayLabelForSelection(selectionId)}`;
  }

  try {
    backendSynced = await trySyncToOpenClaw(resolvedModelId);
    if (!backendSynced && isTauriRuntime()) {
      const profile = await import("../openclaw/env-bridge").then((m) => m.fetchDistributionProfile());
      if (profile?.profile === "relay-station") {
        message = `${message}（本机偏好已保存，网关模型未同步）`;
      }
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      selectionId,
      resolvedModelId,
      backendSynced: false,
      message: `模型切换失败：${err.slice(0, 120)}`,
    };
  }

  return {
    ok: true,
    selectionId,
    resolvedModelId,
    backendSynced,
    message,
  };
}

/** 供发送消息前读取当前生效模型（会话级 override 经 sessions.patch 写入）。 */
export function getActiveModelForRequest(selectionId: ModelSelectionId): string {
  return getResolvedModelId(selectionId);
}
