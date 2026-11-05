import { memo, useEffect, useMemo, useState } from "react";
import { AUTO_MODEL_ID } from "../../types/model";
import type { CatalogModel, ModelProvider } from "../../types/model";
import { listModelProviderGroups, resolveVendorForSelection } from "../../lib/models/catalog";
import { filterProviderGroupsByKeys } from "../../lib/models/available-by-key";
import { fetchDistributionProfile } from "../../lib/openclaw/env-bridge";
import { INTERNAL_PROFILE_ID } from "../../lib/distribution-profile";
import { useModelStore } from "../../stores/modelStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import { useModelSelectorMenu } from "./useModelSelectorMenu";

function IconChevron({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ModelRowProps = {
  model: CatalogModel;
  active: boolean;
  isDefault: boolean;
  onPick: (id: string) => void;
};

const ModelOptionRow = memo(function ModelOptionRow({ model, active, isDefault, onPick }: ModelRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      data-model-id={model.id}
      className={["model-selector__option", active ? "model-selector__option--active" : ""].join(" ")}
      onClick={() => onPick(model.id)}
    >
      <span className="model-selector__option-main">
        <span className="model-selector__option-name truncate">{model.label}</span>
      </span>
      <span className="model-selector__option-meta">
        {isDefault ? <span className="model-selector__tag model-selector__tag--default">默认</span> : null}
      </span>
      <span className="model-selector__check" aria-hidden={!active}>
        {active ? "✓" : ""}
      </span>
    </button>
  );
});

type Props = {
  disabled?: boolean;
};

export const ModelSelector = memo(function ModelSelector({ disabled }: Props) {
  const selectionId = useModelStore((s) => s.selectionId);
  const displayLabel = useModelStore((s) => s.displayLabel);
  const switching = useModelStore((s) => s.switching);
  const hydrate = useModelStore((s) => s.hydrate);
  const selectModel = useModelStore((s) => s.selectModel);
  const storeProfileId = useModelStore((s) => s.profileId);
  const defaultModelId = useModelStore((s) => s.defaultModelId);
  const allowedProviders = useModelStore((s) => s.allowedProviders);
  const showToast = useUiStore((s) => s.showToast);
  const modelSelectorOpenTick = useUiStore((s) => s.modelSelectorOpenTick);
  const reconnect = useGatewayStore((s) => s.connect);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [vendor, setVendor] = useState<ModelProvider | "">("");
  const { open, openMenu, closeMenu, toggleMenu, rootRef } = useModelSelectorMenu(selectionId);

  const effectiveProfile = storeProfileId ?? profileId;
  const groups = useMemo(
    () =>
      filterProviderGroupsByKeys(listModelProviderGroups(effectiveProfile), {
        profileId: effectiveProfile,
        allowedProviders,
      }),
    [effectiveProfile, allowedProviders],
  );
  const autoActive = selectionId === AUTO_MODEL_ID;
  const activeGroup = groups.find((g) => g.provider === vendor) ?? groups[0];
  const vendorModels = activeGroup?.models ?? [];

  useEffect(() => {
    if (!open) return;
    const next = resolveVendorForSelection(selectionId, groups);
    if (next) setVendor(next);
  }, [open]);

  useEffect(() => {
    if (groups.length === 0) {
      if (vendor) setVendor("");
      return;
    }
    if (vendor && groups.some((g) => g.provider === vendor)) return;
    const next = resolveVendorForSelection(selectionId, groups);
    if (next) setVendor(next);
  }, [groups, selectionId, vendor]);

  useEffect(() => {
    void fetchDistributionProfile().then((p) => setProfileId(p?.profile ?? INTERNAL_PROFILE_ID));
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (modelSelectorOpenTick <= 0) return;
    openMenu();
  }, [modelSelectorOpenTick, openMenu]);

  const onPick = (id: string) => {
    if (id === selectionId || switching) {
      closeMenu();
      return;
    }
    void (async () => {
      const result = await selectModel(id);
      if (result.message) {
        showToast(result.message, result.ok ? "success" : "error");
      }
      if (result.ok && result.backendSynced) {
        window.setTimeout(() => {
          void reconnect().catch(() => undefined);
        }, 2500);
      }
      closeMenu();
    })();
  };

  return (
    <div ref={rootRef} className="model-selector relative shrink-0">
      <button
        type="button"
        className={[
          "model-selector__trigger",
          open ? "model-selector__trigger--open" : "",
          disabled || switching ? "opacity-55" : "",
        ].join(" ")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`当前模型：${displayLabel}`}
        disabled={disabled || switching}
        onClick={() => (disabled || switching ? undefined : toggleMenu())}
      >
        <span className="model-selector__label truncate">{switching ? "切换中…" : displayLabel}</span>
        <IconChevron className="model-selector__chevron h-3.5 w-3.5 shrink-0" />
      </button>

      {open ? (
        <div role="listbox" aria-label="选择模型" className="model-selector__menu">
          {groups.length > 0 ? (
            <div className="model-selector__vendor">
              <label className="model-selector__vendor-label" htmlFor="model-selector-vendor">
                厂商
              </label>
              <select
                id="model-selector-vendor"
                className="model-selector__vendor-select"
                value={activeGroup?.provider ?? ""}
                aria-label="选择模型厂商"
                onChange={(e) => setVendor(e.target.value as ModelProvider)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {groups.map((group) => (
                  <option key={group.provider} value={group.provider}>
                    {group.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="model-selector__scroll">
            {vendorModels.length === 0 ? (
              <p className="model-selector__vendor-empty">当前厂商暂无可用模型</p>
            ) : (
              vendorModels.map((model) => (
                <ModelOptionRow
                  key={model.id}
                  model={model}
                  active={selectionId === model.id}
                  isDefault={model.id === defaultModelId}
                  onPick={onPick}
                />
              ))
            )}
          </div>

          <div className="model-selector__divider" role="separator" />

          <button
            type="button"
            role="option"
            aria-selected={autoActive}
            className={["model-selector__option", autoActive ? "model-selector__option--active" : ""].join(
              " ",
            )}
            onClick={() => onPick(AUTO_MODEL_ID)}
          >
            <span className="model-selector__option-main">
              <span className="model-selector__option-name">Auto</span>
            </span>
            <span className="model-selector__check" aria-hidden={!autoActive}>
              {autoActive ? "✓" : ""}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
});
