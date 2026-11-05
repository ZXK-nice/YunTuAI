import { memo, useCallback, useEffect, useState } from "react";
import { bootstrapCuratedSkills } from "../../lib/openclaw/skill-bootstrap";
import { reloadGatewayAfterSkillInstall } from "../../lib/skills/skill-install-reload";
import { isTauriRuntime } from "../../lib/tauri-env";
import { fetchModuleList } from "../../lib/module-bridge";
import { fetchLoopEngineeringStatus, type LoopEngineeringStatus } from "../../lib/yuntuai/loop-engineering-bridge";
import { useUiStore } from "../../stores/uiStore";

/** 设置页：办事能力运维（精选技能同步 + 循环工程状态 + 模块入口）。 */
export const CapabilityOpsPanel = memo(function CapabilityOpsPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const requestNavToSettings = useUiStore((s) => s.requestNavToSettings);
  const [busy, setBusy] = useState(false);
  const [moduleCount, setModuleCount] = useState<number | null>(null);
  const [loopStatus, setLoopStatus] = useState<LoopEngineeringStatus | null>(null);

  const refreshModuleCount = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const list = await fetchModuleList().catch(() => null);
    setModuleCount(list?.filter((m) => m.enabled).length ?? 0);
  }, []);

  const refreshLoopStatus = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const st = await fetchLoopEngineeringStatus().catch(() => null);
    setLoopStatus(st);
  }, []);

  useEffect(() => {
    void refreshModuleCount();
    void refreshLoopStatus();
  }, [refreshModuleCount, refreshLoopStatus]);

  const onSyncSkills = useCallback(async () => {
    if (!isTauriRuntime() || busy) return;
    setBusy(true);
    try {
      const n = await bootstrapCuratedSkills({ throwOnError: true });
      showToast(n > 0 ? `已同步 ${n} 个精选技能到工作区` : "精选技能已是最新", "success");
      if (n >= 0) {
        const reload = await reloadGatewayAfterSkillInstall();
        if (!reload.skillsStatusOk && reload.message) {
          showToast(reload.message, reload.gatewayRestarted ? "info" : "warning");
        }
      }
      await refreshModuleCount();
      await refreshLoopStatus();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  }, [busy, refreshLoopStatus, refreshModuleCount, showToast]);

  const onOpenModules = useCallback(() => {
    requestNavToSettings("modules");
  }, [requestNavToSettings]);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">办事能力</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-tertiary)]">
        同步精选技能、查看循环工程状态；模块安装请在本页「服务 → 第三方模块」。
      </p>

      {loopStatus && (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-2)]/60 p-3 text-xs text-[var(--text-secondary)]">
          <div className="font-medium text-[var(--text-primary)]">循环工程</div>
          <ul className="mt-1.5 space-y-0.5">
            <li>心跳清单：{loopStatus.heartbeatPresent ? "已就绪" : "未创建"}（任务间隔约 4h）</li>
            <li>本机服务心跳节拍：{loopStatus.heartbeatConfigured ? "已配置（约 1h 检查一次）" : "未配置"}</li>
            <li>改进记录：{loopStatus.improvementsPresent ? `${loopStatus.improvementsLineCount} 行` : "暂无"}</li>
          </ul>
          {loopStatus.improvementsPreview.trim() && (
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              {loopStatus.improvementsPreview.trim()}
            </pre>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !isTauriRuntime()}
          onClick={() => void onSyncSkills()}
          className="yt-btn-svc"
        >
          {busy ? "同步中…" : "同步精选技能"}
        </button>
        <button
          type="button"
          disabled={!isTauriRuntime()}
          onClick={onOpenModules}
          className="yt-btn-svc"
        >
          打开模块管理
        </button>
        <button
          type="button"
          disabled={!isTauriRuntime()}
          onClick={() => void refreshLoopStatus()}
          className="yt-btn-svc"
        >
          刷新循环工程状态
        </button>
        {moduleCount != null && (
          <span className="text-[11px] text-[var(--text-muted)]">已启用模块 {moduleCount}</span>
        )}
      </div>
    </section>
  );
});
