import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEEPSEEK_API_KEY_ID,
  DIRECT_MODEL_PROVIDER_KEY_GROUPS,
  MODEL_PROVIDER_KEY_SETUP_HINT,
  hasRequiredModelProviderKey,
} from "../../lib/openclaw/api-key-policy";
import type { EnvKeyRequirement } from "../../lib/openclaw/env-bridge";
import {
  clearLlmSlot,
  fetchLlmPresets,
  fetchLlmSlots,
  saveLlmSlot,
  slotToCatalogModel,
  type LlmPreset,
  type UserLlmSlot,
} from "../../lib/openclaw/user-llm-bridge";
import { cliGatewaySupervisorRestart } from "../../lib/openclaw/cli-bridge";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { setUserCatalogModels } from "../../lib/models/catalog";
import { useModelStore } from "../../stores/modelStore";
import { useUiStore } from "../../stores/uiStore";
import { isTauriRuntime } from "../../lib/tauri-env";

type VendorChoice =
  | {
      kind: "builtin";
      id: string;
      label: string;
      hint: string;
      envKey: string;
      configured: boolean;
    }
  | {
      kind: "extra";
      id: string;
      label: string;
      hint: string;
      envKey: string;
      configured: boolean;
      exampleModel: string;
      allowsCustomBaseUrl: boolean;
      defaultBaseUrl: string;
    };

function extraSlotModelId(slots: UserLlmSlot[], id: string): string {
  return slots.find((s) => s.id === id)?.modelId || "";
}

function extraSlotBaseUrl(slots: UserLlmSlot[], id: string): string {
  return slots.find((s) => s.id === id)?.baseUrl || "";
}

function applySlotsToCatalog(slots: UserLlmSlot[]) {
  setUserCatalogModels(
    slots.map(slotToCatalogModel).filter((m): m is NonNullable<typeof m> => Boolean(m)),
  );
}

type Props = {
  envKeys: EnvKeyRequirement[];
  busy?: boolean;
  submitLabel?: string;
  onBuiltinSave: (values: Record<string, string>) => Promise<void>;
  onStatusRefresh?: () => Promise<void>;
};

export const ModelVendorConfigBox = memo(function ModelVendorConfigBox({
  envKeys,
  busy: parentBusy = false,
  submitLabel = "保存",
  onBuiltinSave,
  onStatusRefresh,
}: Props) {
  const showToast = useUiStore((s) => s.showToast);
  const [presets, setPresets] = useState<LlmPreset[]>([]);
  const [slots, setSlots] = useState<UserLlmSlot[]>([]);
  const [activeId, setActiveId] = useState(DEEPSEEK_API_KEY_ID);
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState("");

  const busy = parentBusy || localBusy;

  const refreshExtras = useCallback(async () => {
    if (!isTauriRuntime()) {
      setPresets([]);
      setSlots([]);
      return;
    }
    const [nextPresets, nextSlots] = await Promise.all([
      fetchLlmPresets().catch(() => []),
      fetchLlmSlots().catch(() => []),
    ]);
    setPresets(nextPresets);
    setSlots(nextSlots);
    applySlotsToCatalog(nextSlots);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refreshExtras(), 200);
    return () => clearTimeout(t);
  }, [refreshExtras]);

  const vendors = useMemo<VendorChoice[]>(() => {
    const builtin: VendorChoice[] = DIRECT_MODEL_PROVIDER_KEY_GROUPS.map((group) => {
      const keyDef = envKeys.find((k) => k.id === group.id);
      return {
        kind: "builtin" as const,
        id: group.id,
        label: group.providerLabel,
        hint: group.modelHint,
        envKey: group.id,
        configured: Boolean(keyDef?.configured),
      };
    }).filter((v) => envKeys.some((k) => k.id === v.id && k.editable !== false));

    const extra: VendorChoice[] = presets.map((preset) => {
      const slot = slots.find((s) => s.id === preset.id);
      return {
        kind: "extra" as const,
        id: preset.id,
        label: preset.label,
        hint: preset.exampleModel,
        envKey: preset.envKey,
        configured: Boolean(slot?.configured),
        exampleModel: preset.exampleModel,
        allowsCustomBaseUrl: preset.allowsCustomBaseUrl,
        defaultBaseUrl: preset.defaultBaseUrl,
      };
    });
    return [...builtin, ...extra];
  }, [envKeys, presets, slots]);

  const vendor = vendors.find((v) => v.id === activeId) ?? vendors[0];

  const vendorId = vendor?.id ?? "";
  const extraModelId = vendor?.kind === "extra" ? extraSlotModelId(slots, vendorId) : "";
  const extraBaseUrl = vendor?.kind === "extra" ? extraSlotBaseUrl(slots, vendorId) : "";

  useEffect(() => {
    if (!vendorId) return;
    setApiKey("");
    setError("");
    if (vendor?.kind === "extra") {
      setModelId(extraModelId);
      setBaseUrl(extraBaseUrl || vendor.defaultBaseUrl);
      return;
    }
    setModelId("");
    setBaseUrl("");
  }, [vendorId, extraModelId, extraBaseUrl]);

  if (!vendor) return null;

  const onSave = async () => {
    setError("");
    const key = apiKey.trim();
    if (vendor.kind === "builtin") {
      if (!key) {
        setError(
          hasRequiredModelProviderKey(envKeys, {})
            ? "请填写 API Key"
            : MODEL_PROVIDER_KEY_SETUP_HINT,
        );
        return;
      }
      setLocalBusy(true);
      try {
        await onBuiltinSave({ [vendor.envKey]: key });
        setApiKey("");
        showToast(`${vendor.label} 已保存`, "success");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLocalBusy(false);
      }
      return;
    }

    if (!key) {
      setError("请填写该厂商 API Key");
      return;
    }
    if (!modelId.trim()) {
      setError("请填写控制台里的模型名称");
      return;
    }
    setLocalBusy(true);
    try {
      const next = await saveLlmSlot({
        id: vendor.id,
        apiKey: key,
        modelId: modelId.trim(),
        baseUrl: baseUrl.trim(),
      });
      setSlots(next);
      applySlotsToCatalog(next);
      setApiKey("");
      showToast(`${vendor.label} 已保存，正在重启本机服务…`, "info");
      await cliGatewaySupervisorRestart().catch(() => null);
      await connectWithFeedback("保存模型接入后重连", { skipPrepare: true }).catch(() => undefined);
      void useModelStore.getState().hydrate(true);
      await onStatusRefresh?.();
      showToast(`${vendor.label} 已可用`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(false);
    }
  };

  const onClear = async () => {
    if (vendor.kind !== "extra" || !vendor.configured) return;
    setLocalBusy(true);
    setError("");
    try {
      const next = await clearLlmSlot(vendor.id);
      setSlots(next);
      applySlotsToCatalog(next);
      setModelId("");
      setApiKey("");
      void useModelStore.getState().hydrate(true);
      showToast(`已移除 ${vendor.label}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLocalBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-[var(--text-secondary)]" htmlFor="model-vendor">
          厂商
        </label>
        <select
          id="model-vendor"
          value={vendor.id}
          onChange={(e) => setActiveId(e.target.value)}
          className="yt-input mt-1 w-full px-3 py-2 text-sm"
          disabled={busy}
        >
          {vendors.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.configured ? "（已接入）" : ""}
            </option>
          ))}
        </select>
        {vendor.hint ? (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">{vendor.hint}</p>
        ) : null}
      </div>

      {vendor.kind === "extra" && vendor.allowsCustomBaseUrl ? (
        <div>
          <label className="text-xs text-[var(--text-secondary)]" htmlFor="model-vendor-url">
            接口地址
          </label>
          <input
            id="model-vendor-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={vendor.defaultBaseUrl}
            className="yt-input mt-1 w-full px-3 py-2 text-sm"
            disabled={busy}
          />
        </div>
      ) : null}

      {vendor.kind === "extra" ? (
        <div>
          <label className="text-xs text-[var(--text-secondary)]" htmlFor="model-vendor-id">
            模型名称
          </label>
          <input
            id="model-vendor-id"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder={`例如 ${vendor.exampleModel}`}
            className="yt-input mt-1 w-full px-3 py-2 text-sm"
            disabled={busy}
          />
        </div>
      ) : null}

      <div>
        <label className="text-xs text-[var(--text-secondary)]" htmlFor="model-vendor-key">
          API Key
        </label>
        <input
          id="model-vendor-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={vendor.configured ? "留空则不修改；保存前请重新输入" : "请输入 API Key"}
          className="yt-input mt-1 w-full px-3 py-2 text-sm"
          disabled={busy}
        />
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void onSave()}>
          {busy ? "保存中…" : submitLabel}
        </button>
        {vendor.kind === "extra" && vendor.configured ? (
          <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void onClear()}>
            移除该厂商
          </button>
        ) : null}
      </div>
    </div>
  );
});
