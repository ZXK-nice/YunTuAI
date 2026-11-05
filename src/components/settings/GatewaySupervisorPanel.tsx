import { memo } from "react";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { isTauriRuntime } from "../../lib/tauri-env";
import { GatewayServiceControls } from "../openclaw/GatewayServiceControls";
import { useGatewayStore } from "../../stores/gatewayStore";

export const GatewaySupervisorPanel = memo(function GatewaySupervisorPanel() {
  const exclusiveReport = useGatewayStore((s) => s.exclusiveReport);
  const refreshExclusiveReport = useGatewayStore((s) => s.refreshExclusiveReport);

  if (!isTauriRuntime()) return null;

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="font-medium text-[var(--text-primary)]">本机服务</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        启动、停止、重启与健康检查；检测到外部进程冲突时可回收控制权。
      </p>
      {exclusiveReport ? (
        <div className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
          <div>
            监管：{sanitizeUserFacingCopy(exclusiveReport.supervisor.message)}
            {exclusiveReport.supervisor.pid != null ? ` (PID ${exclusiveReport.supervisor.pid})` : ""}
          </div>
          <div>内置运行时：{exclusiveReport.bundledReady ? "就绪" : "未就绪"}</div>
          {exclusiveReport.externalGatewayConflict && (
            <div className="text-[var(--color-error)]">检测到外部本机服务进程，请回收控制权。</div>
          )}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="yt-btn-svc" onClick={() => void refreshExclusiveReport()}>
          刷新监管状态
        </button>
      </div>
      <GatewayServiceControls primaryButtons className="mt-3" />
    </div>
  );
});

