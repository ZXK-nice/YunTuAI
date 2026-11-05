import { memo, useCallback, useEffect, useState } from "react";
import { isTauriRuntime } from "../../lib/tauri-env";
import { isInternalProfile } from "../../lib/distribution-profile";
import { fetchDistributionProfile } from "../../lib/openclaw/env-bridge";
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

function applySlotsToCatalog(slots: UserLlmSlot[]) {
  setUserCatalogModels(
    slots.map(slotToCatalogModel).filter((m): m is NonNullable<typeof m> => Boolean(m)),
  );
}

export const DomesticLlmAccessPanel = memo(function DomesticLlmAccessPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [presets, setPresets] = useState<LlmPreset[]>([]);
  const [slots, setSlots] = useState<UserLlmSlot[]>([]);
  const [activeId, setActiveId] = useState("zhipu");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  const refresh = useCallback(async () => {
    const [profile, nextPresets, nextSlots] = await Promise.all([
      fetchDistributionProfile().catch(() => null),
      fetchLlmPresets().catch(() => []),
      fetchLlmSlots().catch(() => []),
    ]);
    if (!isInternalProfile(profile?.profile)) {
      setVisible(false);
      return;
    }
    setVisible(true);
    setPresets(nextPresets);
    setSlots(nextSlots);
    applySlotsToCatalog(nextSlots);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const t = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(t);
  }, [refresh]);

  const preset = presets.find((p) => p.id === activeId) ?? presets[0];
  const slot = slots.find((s) => s.id === (preset?.id ?? activeId));

  useEffect(() => {
    if (!preset) return;
    setModelId(slot?.modelId || "");
    setModelName(slot?.modelName || "");
    setBaseUrl(slot?.baseUrl || preset.defaultBaseUrl);
    setApiKey("");
  }, [preset, slot]);

  if (!visible || !preset) return null;

  const onSave = async () => {
    if (!apiKey.trim()) {
      showToast("请填写该厂商 API Key", "info");
      return;
    }
    if (!modelId.trim()) {
      showToast("请填写模型名称（控制台里的 Model ID）", "info");
      return;
    }
    setBusy(true);
    try {
      const next = await saveLlmSlot({
        id: preset.id,
        apiKey: apiKey.trim(),
        modelId: modelId.trim(),
        modelName: modelName.trim(),
        baseUrl: baseUrl.trim(),
      });
      setSlots(next);
      applySlotsToCatalog(next);
      setApiKey("");
      showToast(`${preset.label} 已保存，正在重启本机服务…`, "info");
      await cliGatewaySupervisorRestart().catch(() => null);
      await connectWithFeedback("保存模型接入后重连", { skipPrepare: true }).catch(() => undefined);
      void useModelStore.getState().hydrate(true);
      showToast(`${preset.label} 已可用`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const onClear = async () => {
    setBusy(true);
    try {
      const next = await clearLlmSlot(preset.id);
      setSlots(next);
      applySlotsToCatalog(next);
      setModelId("");
      setModelName("");
      setApiKey("");
      void useModelStore.getState().hydrate(true);
      showToast(`已移除 ${preset.label}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">更多国内厂商 / 自定义接口</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        自选厂商，自行填写控制台里的模型名与密钥。兼容 OpenAI 接口的国内中转也可选「自定义」。
      </p>

      <label className="mt-3 block text-xs text-[var(--text-secondary)]">厂商</label>
      <select
        value={preset.id}
        onChange={(e) => setActiveId(e.target.value)}
        className="yt-input mt-1 w-full px-3 py-2 text-sm"
        disabled={busy}
      >
        {presets.map((p) => {
          const configured = slots.some((s) => s.id === p.id && s.configured);
          return (
            <option key={p.id} value={p.id}>
              {p.label}
              {configured ? "（已接入）" : ""}
            </option>
          );
        })}
      </select>

      {preset.allowsCustomBaseUrl ? (
        <>
          <label className="mt-3 block text-xs text-[var(--text-secondary)]">接口地址</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={preset.defaultBaseUrl}
            className="yt-input mt-1 w-full px-3 py-2 text-sm"
            disabled={busy}
          />
        </>
      ) : (
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">接口：{preset.defaultBaseUrl}</p>
      )}

      <label className="mt-3 block text-xs text-[var(--text-secondary)]">模型名称（Model ID）</label>
      <input
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        placeholder={`例如 ${preset.exampleModel}`}
        className="yt-input mt-1 w-full px-3 py-2 text-sm"
        disabled={busy}
      />

      <label className="mt-3 block text-xs text-[var(--text-secondary)]">显示名称（可选）</label>
      <input
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
        placeholder="对话里显示的名字"
        className="yt-input mt-1 w-full px-3 py-2 text-sm"
        disabled={busy}
      />

      <label className="mt-3 block text-xs text-[var(--text-secondary)]">API Key</label>
      <input
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={slot?.configured ? "留空不会改密钥；保存前请重新输入" : "请输入 API Key"}
        className="yt-input mt-1 w-full px-3 py-2 text-sm"
        disabled={busy}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void onSave()}>
          {busy ? "保存中…" : slot?.configured ? "更新接入" : "保存并接入"}
        </button>
        {slot?.configured ? (
          <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void onClear()}>
            移除该厂商
          </button>
        ) : null}
      </div>
    </div>
  );
});
