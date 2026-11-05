import { useMemo } from "react";
import { useAppLogo } from "../../hooks/useAppLogo";
import { APP_VERSION } from "../../lib/app-version";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { MODEL_PROVIDER_KEY_SETUP_DESCRIPTION } from "../../lib/openclaw/api-key-policy";
import type { EnvKeyRequirement } from "../../lib/openclaw/env-bridge";
import { ModelVendorConfigBox } from "../settings/ModelVendorConfigBox";

type Props = {
  keys: EnvKeyRequirement[];
  envPath: string;
  busy: boolean;
  onSave: (values: Record<string, string>) => Promise<void>;
};

export function ApiKeySetupScreen({ keys, envPath, busy, onSave }: Props) {
  const logoSrc = useAppLogo();
  const editableKeys = useMemo(
    () => keys.filter((k) => k.editable !== false),
    [keys],
  );

  return (
    <div className="auth-screen">
      <div className="auth-card max-w-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="app-brand-logo-slot app-brand-logo-slot--auth">
            <img src={logoSrc} alt={PRODUCT_NAME} className="app-brand-logo-img select-none" draggable={false} width={88} height={88} />
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">配置 AI 模型</h1>
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            {PRODUCT_NAME} 已内置本机运行时。下拉选择一家厂商，填入 API Key 即可。
            密钥只保存在本机 <span className="font-mono text-[11px]">.env</span>。
          </p>
        </div>

        <ModelVendorConfigBox
          envKeys={editableKeys}
          busy={busy}
          submitLabel="保存并继续"
          onBuiltinSave={onSave}
          onStatusRefresh={() => onSave({})}
        />

        <div className="mt-4 space-y-2 text-[11px] text-[var(--text-muted)]">
          <p>{MODEL_PROVIDER_KEY_SETUP_DESCRIPTION}</p>
          {envPath ? (
            <p className="truncate font-mono text-[10px] opacity-70" title={envPath}>
              {envPath}
            </p>
          ) : null}
        </div>

        <p className="mt-4 text-center text-[11px] text-[var(--text-muted)]">{PRODUCT_NAME} v{APP_VERSION}</p>
      </div>
    </div>
  );
}

export default ApiKeySetupScreen;
