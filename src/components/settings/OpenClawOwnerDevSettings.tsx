import { memo, useCallback, useEffect, useState } from "react";
import type { OpenClawControlDiscovery } from "../../lib/openclaw/cli-bridge";
import {
  cliGatewaySupervisorRestart,
  cliOpenClawControlAdopt,
  cliOpenClawControlDiscover,
  cliOpenClawControlWriteConfig,
  cliOpenClawMigrateFromLegacy,
} from "../../lib/openclaw/cli-bridge";
import { fetchCurrentModel } from "../../lib/openclaw/env-bridge";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { formatUserFacingPath, sanitizeUserFacingCopy } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { LicenseIssuerPanel } from "../owner/LicenseIssuerPanel";
import { OwnerUserManagement } from "../owner/OwnerUserManagement";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";

export const OpenClawOwnerDevSettings = memo(function OpenClawOwnerDevSettings() {
  const showToast = useUiStore((s) => s.showToast);
  const loadGatewayPrefs = useGatewayStore((s) => s.loadGatewayPrefs);
  const [controlDiscovery, setControlDiscovery] = useState<OpenClawControlDiscovery | null>(null);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  // 受控组件：模型 ID 与自定义上下文值（替代 DOM API 直读）
  const [modelId, setModelId] = useState("");
  const [customCtx, setCustomCtx] = useState("");
  // 确认对话框状态
  const [confirmCtxPreset, setConfirmCtxPreset] = useState<string | null>(null); // preset label
  const [confirmCtxPresetValue, setConfirmCtxPresetValue] = useState(0);
  const [confirmCtxCustom, setConfirmCtxCustom] = useState(false);
  const [confirmMigrate, setConfirmMigrate] = useState(false);

  const refreshDiscovery = () => {
    void cliOpenClawControlDiscover().then(setControlDiscovery);
  };

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const t = setTimeout(() => refreshDiscovery(), 300);
    void fetchCurrentModel().then((m) => {
      if (m) setModelId(m);
    });
    return () => clearTimeout(t);
  }, []);

  // 执行上下文预设写入
  const executePresetCtx = useCallback(async () => {
    const mId = modelId.trim();
    if (!mId) {
      showToast("请先填写模型 ID", "error");
      return;
    }
    setConfirmCtxPreset(null);
    setConfigBusy(true);
    try {
      const r = await cliOpenClawControlWriteConfig({
        agents: { models: { [mId]: { params: { contextWindow: confirmCtxPresetValue } } } },
      });
      if (!r) { showToast("写入配置失败", "error"); return; }
      showToast("配置已写入，正在重启本机服务…", "info");
      await cliGatewaySupervisorRestart();
      await connectWithFeedback("上下文参数变更后重连", { skipPrepare: true }).catch(() => undefined);
      showToast(`${mId} 上下文已扩至 ${confirmCtxPresetValue.toLocaleString()}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setConfigBusy(false);
    }
  }, [modelId, confirmCtxPresetValue, showToast]);

  // 执行自定义上下文写入
  const executeCustomCtx = useCallback(async () => {
    const mId = modelId.trim();
    if (!mId) {
      showToast("请先填写模型 ID", "error");
      return;
    }
    const ctx = parseInt(customCtx, 10);
    setConfirmCtxCustom(false);
    setConfigBusy(true);
    try {
      const r = await cliOpenClawControlWriteConfig({
        agents: { models: { [mId]: { params: { contextWindow: ctx } } } },
      });
      if (!r) { showToast("写入配置失败", "error"); return; }
      showToast("配置已写入，正在重启本机服务…", "info");
      await cliGatewaySupervisorRestart();
      await connectWithFeedback("上下文参数变更后重连", { skipPrepare: true }).catch(() => undefined);
      showToast(`${mId} 上下文已设为 ${ctx.toLocaleString()}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setConfigBusy(false);
    }
  }, [modelId, customCtx, showToast]);

  // 执行迁移导入
  const executeMigration = useCallback(async () => {
    setConfirmMigrate(false);
    setMigrateBusy(true);
    try {
      const r = await cliOpenClawMigrateFromLegacy(true);
      if (!r?.ok) {
        showToast(r?.message ?? "导入失败", "error");
        return;
      }
      showToast(`导入完成：${r.copiedDirs.length} 个目录、${r.copiedFiles.length} 个文件`, "success");
      refreshDiscovery();
      await loadGatewayPrefs();

      showToast("正在重启本机服务…", "info");
      await cliGatewaySupervisorRestart();

      let connected = false;
      for (let i = 0; i < 3; i++) {
        connected = await connectWithFeedback("导入旧版数据后重连", {
          skipPrepare: true,
        }).catch(() => false);
        if (connected && useGatewayStore.getState().connState === "connected") {
          break;
        }
        if (i < 2) await new Promise((r) => setTimeout(r, 1500));
      }
      if (connected) {
        showToast("连接成功", "success");
      } else {
        showToast("本机服务已重启，但连接超时。请稍后手动点「连接服务」。", "info");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setMigrateBusy(false);
    }
  }, [showToast, loadGatewayPrefs]);

  return (
    <>
      <LicenseIssuerPanel />
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="font-medium text-[var(--text-primary)]">深度运维（Owner）</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          配置接管、数据迁移、封存防篡改等，供厂商远程协助用户排查时使用。
        </p>
        {controlDiscovery ? (
          <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
            <div>数据目录：{formatUserFacingPath(controlDiscovery.managedDataDir)}</div>
            <div>内置运行时：{controlDiscovery.bundledReady ? "就绪" : "未就绪"}</div>
            {controlDiscovery.globalOpenclawInPath && (
              <div className="text-[var(--warn-text)]">
                系统 PATH 运行时：{sanitizeUserFacingCopy(controlDiscovery.globalOpenclawVersion ?? "已检测")}
              </div>
            )}
            {controlDiscovery.legacyHomeExists && (
              <div className="text-[var(--warn-text)]">旧目录：{formatUserFacingPath(controlDiscovery.legacyHomeDir)}</div>
            )}
            <div>{sanitizeUserFacingCopy(controlDiscovery.recommendedAction)}</div>
          </div>
        ) : null}
        {controlDiscovery?.migrationRecommended ? (
          <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-[11px] leading-relaxed text-sky-100">
            <div className="font-medium text-sky-50">从旧版用户目录导入训练数据</div>
            <p className="mt-1 text-sky-100/90">
              检测到 <span className="font-mono">{formatUserFacingPath(controlDiscovery.legacyHomeDir)}</span> 中有
              workspace、memory、agents 等内容（丰富度 {controlDiscovery.legacyRichnessScore}）。
            </p>
            <button
              type="button"
              disabled={migrateBusy}
              className="mt-2 rounded-lg border border-sky-300/40 bg-sky-400/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400/30 disabled:opacity-50"
              onClick={() => setConfirmMigrate(true)}
            >
              {migrateBusy ? "导入与重连中…" : "从旧版用户目录导入"}
            </button>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="yt-btn-svc"
            onClick={() =>
              void cliOpenClawControlAdopt(false).then(() => {
                showToast("已接管本机服务", "success");
                void cliOpenClawControlDiscover().then(setControlDiscovery);
              })
            }
          >
            接管本机服务
          </button>
        </div>
      </div>

      {/* ── 模型上下文窗口配置 ───────────────────────────── */}
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="font-medium text-[var(--text-primary)]">模型上下文窗口</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          写入服务配置（agents.models.&lt;模型名&gt;.params.contextWindow，deep-merge）。修改后需重启本机服务生效。
        </p>
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] text-[var(--text-secondary)]">模型 ID（短名，如 deepseek-flash）</label>
          <input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
          />
          <label className="block text-[11px] text-[var(--text-secondary)]">上下文窗口大小</label>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "128K", value: 131_072 },
              { label: "512K", value: 524_288 },
              { label: "1M", value: 1_048_576 },
              { label: "2M", value: 2_097_152 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={configBusy}
                className="yt-btn-svc"
                onClick={() => {
                  setConfirmCtxPreset(preset.label);
                  setConfirmCtxPresetValue(preset.value);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={4096}
              max={4_194_304}
              value={customCtx}
              onChange={(e) => setCustomCtx(e.target.value)}
              placeholder="自定义值"
              className="w-28 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]"
            />
            <button
              type="button"
              disabled={configBusy}
              className="yt-btn-svc"
              onClick={() => {
                const ctx = parseInt(customCtx, 10);
                if (!ctx || ctx < 4096) { showToast("请输入有效的上下文大小（≥ 4096）", "error"); return; }
                setConfirmCtxCustom(true);
              }}
            >
              {configBusy ? "写入中…" : "应用自定义"}
            </button>
          </div>
        </div>
      </div>
      <OwnerUserManagement />

      {/* 迁移确认对话框 */}
      <ConfirmDialog
        open={confirmMigrate}
        title="从旧版用户目录导入？"
        titleId="oc-migrate-confirm-title"
        variant="default"
        confirmLabel="导入"
        onClose={() => setConfirmMigrate(false)}
        onConfirm={() => void executeMigration()}
      >
        <p>
          确认从旧版用户目录导入？会复制 workspace / memory / agents / 插件等；旧目录将重命名为备份。
        </p>
      </ConfirmDialog>

      {/* 上下文预设确认对话框 */}
      <ConfirmDialog
        open={confirmCtxPreset !== null}
        title="修改上下文窗口"
        titleId="oc-ctx-preset-title"
        variant="default"
        confirmLabel="确认并重启"
        onClose={() => setConfirmCtxPreset(null)}
        onConfirm={() => void executePresetCtx()}
      >
        <p>
          将 <code className="rounded bg-[var(--bg-hover)] px-1">{modelId.trim() || "gpt-5.5"}</code> 的
          contextWindow 设为 {confirmCtxPreset}（{confirmCtxPresetValue.toLocaleString()}）并重启本机服务？
        </p>
      </ConfirmDialog>

      {/* 自定义上下文确认对话框 */}
      <ConfirmDialog
        open={confirmCtxCustom}
        title="自定义上下文窗口"
        titleId="oc-ctx-custom-title"
        variant="default"
        confirmLabel="确认并重启"
        onClose={() => setConfirmCtxCustom(false)}
        onConfirm={() => void executeCustomCtx()}
      >
        <p>
          将 <code className="rounded bg-[var(--bg-hover)] px-1">{modelId.trim() || "gpt-5.5"}</code> 的
          contextWindow 设为 {parseInt(customCtx, 10).toLocaleString()} 并重启本机服务？
        </p>
      </ConfirmDialog>
    </>
  );
});

