import type { GatewayCliResult } from "../../lib/openclaw/cli-bridge";
import { cliGatewaySupervisorRestart } from "../../lib/openclaw/cli-bridge";
import { useGatewayServiceActions, type GatewayServiceAction } from "../../hooks/useGatewayServiceActions";
import { memo, useCallback, useState } from "react";
import { isTauriRuntime } from "../../lib/tauri-env";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";
import { connectWithFeedback } from "../../lib/connect-with-feedback";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { repairServiceConfig } from "../../lib/openclaw/service-config-repair";



const btn = "yt-btn-svc";

const btnPrimary = "yt-btn-primary text-xs px-3 py-1.5";



function OutputBlock({ title, result }: { title: string; result: GatewayCliResult | null }) {

  if (!result) return null;

  return (

    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-black/15 p-3 text-xs">

      <div className="flex items-center justify-between gap-2">

        <span>{title}</span>

        <span className={result.ok ? "text-emerald-300" : "text-rose-300"}>

          {result.ok ? "成功" : `失败 (exit ${result.exitCode ?? "?"})`}

        </span>

      </div>

      {result.stdout ? (

        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">{sanitizeUserFacingCopy(result.stdout)}</pre>

      ) : null}

      {result.stderr ? (

        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-amber-200/90">{sanitizeUserFacingCopy(result.stderr)}</pre>

      ) : null}

    </div>

  );

}



type Props = {

  /** 仪表盘：展示 CLI 输出块 */

  showCliOutput?: boolean;

  /** 设置页：主按钮样式 */

  primaryButtons?: boolean;

  className?: string;

};



export const GatewayServiceControls = memo(function GatewayServiceControls({ showCliOutput, primaryButtons, className }: Props) {

  const { busy, lastResult, lastLabel, runAction } = useGatewayServiceActions();

  const reclaimExclusive = useGatewayStore((s) => s.reclaimExclusive);

  const exclusiveReport = useGatewayStore((s) => s.exclusiveReport);

  const showToast = useUiStore((s) => s.showToast);

  const [repairBusy, setRepairBusy] = useState(false);

  const onRepairConfig = useCallback(async () => {
    setRepairBusy(true);
    try {
      const res = await repairServiceConfig();
      showToast(sanitizeUserFacingCopy(res.message), res.changed ? "success" : "info");
      if (res.changed) {
        await cliGatewaySupervisorRestart();
        await connectWithFeedback("修复服务配置后重连", { skipPrepare: true }).catch(() => undefined);
      }
    } catch (e) {
      showToast(sanitizeUserFacingCopy(e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setRepairBusy(false);
    }
  }, [showToast]);



  if (!isTauriRuntime()) return null;



  const actionBtn = primaryButtons ? btnPrimary : btn;

  const secondaryBtn = primaryButtons ? btn : btn;



  const onAction = (action: GatewayServiceAction) => {

    void runAction(action, { showOutput: showCliOutput, reconnect: true });

  };



  return (

    <div className={className}>

      <div className="flex flex-wrap gap-2">

        <button type="button" disabled={!!busy} className={secondaryBtn} onClick={() => onAction("health")}>

          {busy === "health" ? "检查中…" : "健康检查"}

        </button>

        <button type="button" disabled={!!busy} className={actionBtn} onClick={() => onAction("start")}>

          {busy === "start" ? "启动中…" : "启动本机服务"}

        </button>

        <button type="button" disabled={!!busy} className={secondaryBtn} onClick={() => onAction("stop")}>

          {busy === "stop" ? "停止中…" : "停止本机服务"}

        </button>

        <button type="button" disabled={!!busy} className={secondaryBtn} onClick={() => onAction("restart")}>

          {busy === "restart" ? "重启中…" : "重启本机服务"}

        </button>

        <button
          type="button"
          disabled={!!busy || repairBusy}
          className={secondaryBtn}
          onClick={() => void onRepairConfig()}
          title="修复服务配置文件中的浏览器颜色等不合法项"
        >
          {repairBusy ? "修复中…" : "修复服务配置"}
        </button>

        {(exclusiveReport?.externalGatewayConflict || exclusiveReport?.globalOpenclawInPath) && (

          <button

            type="button"

            disabled={!!busy}

            className={secondaryBtn}

            onClick={() =>

              void reclaimExclusive().then((ok) => {

                showToast(ok ? "已回收控制权" : "回收失败", ok ? "success" : "error");

                if (ok) void connectWithFeedback("回收控制权后重连");

              })

            }

          >

            回收控制权

          </button>

        )}

      </div>

      {showCliOutput ? <OutputBlock title={lastLabel} result={lastResult} /> : null}

    </div>

  );

});


