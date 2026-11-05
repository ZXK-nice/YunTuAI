import { create } from "zustand";
import type { ModelProvider, ModelSelectionId, ModelSwitchResult } from "../types/model";
import { AUTO_MODEL_ID } from "../types/model";
import {
  getActiveModelForRequest,
  getSelectionDisplayLabel,
  persistSelection,
  pullBackendModelSelection,
  readPersistedSelection,
  switchModel,
} from "../lib/models/model-api";
import {
  availabilityFromEnv,
  isModelAllowedForKeys,
} from "../lib/models/available-by-key";
import { setRuntimeDefaultModelId } from "../lib/models/runtime-default-model";
import { fetchDistributionProfile, fetchOpenClawEnvStatus } from "../lib/openclaw/env-bridge";
import { fetchLlmSlots, slotToCatalogModel } from "../lib/openclaw/user-llm-bridge";
import { setUserCatalogModels } from "../lib/models/catalog";
import { isRelayProfile } from "../lib/distribution-profile";
import { patchSessionModelForSend } from "../lib/openclaw/session-model";
import { getItem } from "../lib/safeStorage";
import { useSessionStore } from "./sessionStore";
import { useGatewayStore } from "./gatewayStore";

type ModelState = {
  selectionId: ModelSelectionId;
  resolvedModelId: string;
  displayLabel: string;
  switching: boolean;
  hydrated: boolean;
  profileId: string | null;
  defaultModelId: string;
  allowedProviders: Set<ModelProvider> | null;
  hydrate: (force?: boolean) => Promise<void>;
  selectModel: (id: ModelSelectionId) => Promise<ModelSwitchResult>;
};

function toSnapshot(selectionId: ModelSelectionId) {
  return {
    selectionId,
    resolvedModelId: getActiveModelForRequest(selectionId),
    displayLabel: getSelectionDisplayLabel(selectionId),
  };
}

export const useModelStore = create<ModelState>((set, get) => ({
  ...toSnapshot(AUTO_MODEL_ID),
  switching: false,
  hydrated: false,
  profileId: null,
  defaultModelId: getActiveModelForRequest(AUTO_MODEL_ID),
  allowedProviders: null,

  hydrate: async (force = false) => {
    if (get().hydrated && !force) return;
    const [profile, status, slots] = await Promise.all([
      fetchDistributionProfile().catch(() => null),
      fetchOpenClawEnvStatus().catch(() => null),
      fetchLlmSlots().catch(() => []),
    ]);
    const profileId = profile?.profile ?? null;
    const relay = isRelayProfile(profileId);
    setUserCatalogModels(
      relay
        ? []
        : slots.map(slotToCatalogModel).filter((m): m is NonNullable<typeof m> => Boolean(m)),
    );
    const availability = availabilityFromEnv(status?.keys, profileId);
    const extraProviders = relay ? [] : slots
      .filter((s) => s.configured)
      .map((s) => s.id as ModelProvider);
    let allowedProviders = availability.allowedProviders;
    if (extraProviders.length > 0) {
      allowedProviders = new Set(allowedProviders ?? []);
      for (const p of extraProviders) allowedProviders.add(p);
    }
    const defaultModelId =
      extraProviders.length > 0 && availability.allowedProviders == null
        ? slots.find((s) => s.configured)?.modelId.trim() || availability.defaultModelId
        : availability.defaultModelId;
    setRuntimeDefaultModelId(defaultModelId);

    let selectionId = readPersistedSelection();
    const hadPersisted = !!getItem("yuntuai:model-selection")?.trim();
    if (selectionId !== AUTO_MODEL_ID) {
      const backend = await pullBackendModelSelection();
      if (backend && backend !== AUTO_MODEL_ID) selectionId = backend;
      if (!isModelAllowedForKeys(selectionId, allowedProviders, profileId)) {
        selectionId = AUTO_MODEL_ID;
        persistSelection(AUTO_MODEL_ID);
      }
    } else if (!hadPersisted) {
      persistSelection(AUTO_MODEL_ID);
    }
    set({
      ...toSnapshot(selectionId),
      hydrated: true,
      profileId,
      defaultModelId,
      allowedProviders,
    });
  },

  selectModel: async (id) => {
    const { allowedProviders, profileId } = get();
    if (id !== AUTO_MODEL_ID && !isModelAllowedForKeys(id, allowedProviders, profileId)) {
      return {
        ok: false,
        selectionId: get().selectionId,
        resolvedModelId: get().resolvedModelId,
        backendSynced: false,
        message: "尚未配置该厂商 API Key，请先在「API 接入」填写后再切换。",
      };
    }
    set({ switching: true });
    try {
      const result = await switchModel(id);
      if (result.ok) {
        set(toSnapshot(result.selectionId));
        const gw = useGatewayStore.getState();
        if (gw.connState === "connected") {
          const sess = useSessionStore.getState();
          const active = sess.activeId
            ? sess.sessions.find((s) => s.id === sess.activeId)
            : null;
          const key = active?.remoteSessionKey?.trim();
          if (key) {
            void patchSessionModelForSend(key, result.selectionId).catch(() => undefined);
          }
        }
      }
      return result;
    } finally {
      set({ switching: false });
    }
  },
}));
