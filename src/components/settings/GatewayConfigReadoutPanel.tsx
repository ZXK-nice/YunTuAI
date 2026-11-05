import { memo, useCallback, useEffect, useState } from "react";
import { cliOpenClawControlReadConfig, type OpenClawConfigFileView } from "../../lib/openclaw/cli-bridge";
import { fetchGatewayRuntimeConfig, type GatewayRuntimeConfig } from "../../lib/openclaw/gateway-tools";
import { formatUserFacingPath } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";

export const GatewayConfigReadoutPanel = memo(function GatewayConfigReadoutPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const connState = useGatewayStore((s) => s.connState);
  const [diskView, setDiskView] = useState<OpenClawConfigFileView | null>(null);
  const [runtimeCfg, setRuntimeCfg] = useState<GatewayRuntimeConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [disk, runtime] = await Promise.all([
        cliOpenClawControlReadConfig().catch(() => null),
        connState === "connected"
          ? fetchGatewayRuntimeConfig().catch(() => null)
          : Promise.resolve(null),
      ]);
      setDiskView(disk);
      setRuntimeCfg(runtime);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [showToast, connState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isTauriRuntime()) return null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-[var(--text-primary)]">配置读取</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            从磁盘服务配置 + 本机服务双路读取当前配置。
          </p>
        </div>
        <button type="button" className="yt-btn-svc" disabled={busy} onClick={() => void refresh()}>
          {busy ? "读取中…" : "刷新"}
        </button>
      </div>

      {runtimeCfg ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">服务模式</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.gateway.mode || "—"}
            </span>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">端口</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.gateway.port || "—"}
            </span>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">绑定</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.gateway.bind || "—"}
            </span>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">认证</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.gateway.authMode || "—"}
            </span>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">模型</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.defaultModel || "—"}
            </span>
          </div>
          <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
            <span className="text-[var(--text-muted)]">沙箱</span>
            <span className="ml-2 font-medium text-[var(--text-primary)]">
              {runtimeCfg.sandboxMode || "—"}
            </span>
          </div>
          {runtimeCfg.workspace ? (
            <div className="col-span-2 rounded-lg bg-[var(--bg-elevated)] p-2">
              <span className="text-[var(--text-muted)]">工作区</span>
              <span className="ml-2 font-medium text-[var(--text-primary)] break-all">
                {formatUserFacingPath(runtimeCfg.workspace)}
              </span>
            </div>
          ) : null}
          {runtimeCfg.providerNames.length > 0 ? (
            <div className="col-span-2 rounded-lg bg-[var(--bg-elevated)] p-2">
              <span className="text-[var(--text-muted)]">Provider / 模型</span>
              <div className="mt-1 space-y-0.5">
                {runtimeCfg.providerNames.map((p) => (
                  <div key={p} className="text-[var(--text-primary)]">
                    <span className="font-medium">{p}</span>
                    {runtimeCfg.providerModels[p]?.length ? (
                      <span className="ml-2 text-[var(--text-secondary)]">
                        {runtimeCfg.providerModels[p]!.join("、")}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : diskView ? (
        <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
          磁盘配置已读取（SHA256: {diskView.sha256?.slice(0, 12) ?? "无"}
          ），路由器未连接，无法获取运行时配置。
        </div>
      ) : null}
    </div>
  );
});

