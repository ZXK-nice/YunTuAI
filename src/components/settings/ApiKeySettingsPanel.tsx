import { memo, useCallback, useEffect, useState } from "react";
import { MODEL_PROVIDER_KEY_SETUP_HINT } from "../../lib/openclaw/api-key-policy";
import {
  fetchOpenClawEnvStatus,
  saveOpenClawEnvKeys,
  fetchCurrentModel,
  setModel,
  type OpenClawEnvStatus,
} from "../../lib/openclaw/env-bridge";
import { cliGatewaySupervisorRestart } from "../../lib/openclaw/cli-bridge";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { isTauriRuntime } from "../../lib/tauri-env";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { useUiStore } from "../../stores/uiStore";
import { useModelStore } from "../../stores/modelStore";
import { ModelVendorConfigBox } from "./ModelVendorConfigBox";

export const ApiKeySettingsPanel = memo(function ApiKeySettingsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const [status, setStatus] = useState<OpenClawEnvStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentModel, setCurrentModel] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [modelBusy, setModelBusy] = useState(false);

  const refresh = useCallback(async () => {
    const snap = await fetchOpenClawEnvStatus();
    if (snap) setStatus(snap);
    const mdl = await fetchCurrentModel();
    if (mdl) {
      setCurrentModel(mdl);
      setModelInput(mdl);
    }
    return snap;
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const t = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(t);
  }, [refresh]);

  const onBuiltinSave = async (values: Record<string, string>) => {
    setBusy(true);
    try {
      const snap = await saveOpenClawEnvKeys(values);
      if (!snap) throw new Error("保存失败");
      setStatus(snap);
      showToast("API Key 已保存，正在重启本机服务…", "info");
      await cliGatewaySupervisorRestart().catch(() => null);
      await connectWithFeedback("保存 API Key 后重连", { skipPrepare: true }).catch(() => undefined);
      void useModelStore.getState().hydrate(true);
    } finally {
      setBusy(false);
    }
  };

  const commitModel = async () => {
    const modelId = modelInput.trim();
    if (!modelId || modelId === currentModel) return;
    setModelBusy(true);
    try {
      await setModel(modelId);
      setCurrentModel(modelId);
      setModelInput(modelId);
      void useModelStore.getState().hydrate(true);
      showToast(`模型已设为 ${modelId}，正在重启本机服务…`, "info");
      await cliGatewaySupervisorRestart().catch(() => null);
      await new Promise((r) => setTimeout(r, 3000));
      void connectWithFeedback("切换模型后重连", { skipPrepare: true }).catch(() => undefined);
    } catch (e) {
      setModelInput(currentModel);
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setModelBusy(false);
    }
  };

  if (!isTauriRuntime() || !status?.bundledManaged) return null;

  const apiKeyLocked = status.apiKeyLocked === true;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">{PRODUCT_NAME} · 模型配置</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        {apiKeyLocked
          ? "当前为云图中转站发行版。接口已绑定，模型只能从对话里的上架列表选择，不能填写自有模型或密钥。"
          : "下拉选择厂商并填入 API Key；在下方填写控制台或厂商文档中的模型名称。"}
      </p>
      {status.setupRequired && !apiKeyLocked ? (
        <div className="yt-warn-banner mt-2">{MODEL_PROVIDER_KEY_SETUP_HINT}</div>
      ) : null}

      {!apiKeyLocked ? (
        <div className="mt-3">
          <ModelVendorConfigBox
            envKeys={status.keys.filter((k) => k.editable !== false)}
            busy={busy}
            submitLabel="保存"
            onBuiltinSave={onBuiltinSave}
            onStatusRefresh={async () => {
              await refresh();
            }}
          />
        </div>
      ) : null}

      {!apiKeyLocked ? <div className="mt-4">
        <label className="text-xs text-[var(--text-secondary)]" htmlFor="settings-model-id">
          接口模型 ID
        </label>
        <input
          id="settings-model-id"
          value={modelInput}
          onChange={(e) => setModelInput(e.target.value)}
          onBlur={() => void commitModel()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitModel();
            }
          }}
          placeholder="例如 mimo-v2.6-pro 或 deepseek-flash"
          disabled={modelBusy}
          className="yt-input mt-1 w-full px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          这里填厂商文档里的接口模型 ID，不是界面显示名。例如 MiMo V2.6 Pro 对应 mimo-v2.6-pro。按 Enter 或点击空白处保存。
        </p>
      </div> : null}
    </div>
  );
});
