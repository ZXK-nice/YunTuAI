import { PRODUCT_NAME } from "../product-brand";
import { sanitizeUserFacingCopy } from "../product-copy";

export type StartupToastVariant = "success" | "error" | "info";

export type ExclusiveReportLike = {
  supervisor: { running: boolean; pid?: number | null };
  externalGatewayConflict: boolean;
  globalOpenclawInPath: boolean;
  warnings: string[];
};

export type StartupToastPayload = {
  key: string;
  message: string;
  variant: StartupToastVariant;
};

/** 根据 网关 独占监管报告生成一次性 toast（不含 session 去重）。 */
export function resolveExclusiveStartupToast(
  report: ExclusiveReportLike,
): StartupToastPayload | null {
  const { supervisor, externalGatewayConflict, globalOpenclawInPath, warnings } = report;
  const hasConflict = externalGatewayConflict || globalOpenclawInPath;

  if (hasConflict) {
    if (externalGatewayConflict) {
      return {
        key: `conflict:${externalGatewayConflict}:${globalOpenclawInPath}`,
        message:
          `检测到未受 ${PRODUCT_NAME} 监管的本机服务占用端口，请点击「手动重连」或 软件设置 → 本机服务 →「回收控制权」`,
        variant: "error",
      };
    }
    return {
      key: `conflict:${externalGatewayConflict}:${globalOpenclawInPath}`,
      message: "检测到系统全局本机版，可能与内置版本冲突",
      variant: "info",
    };
  }

  if (supervisor.running) {
    return {
      key: "ok-running",
      message:
        supervisor.pid != null
          ? `本机服务监管中（PID ${supervisor.pid}）`
          : "本机服务监管中，配置已封存",
      variant: "success",
    };
  }

  const actionable = warnings.filter(
    (w) =>
      !w.startsWith(`本机服务由 ${PRODUCT_NAME} 独占监管`) &&
      !w.startsWith(`网关由 ${PRODUCT_NAME} 独占监管`),
  );
  if (actionable.length === 0) return null;

  return {
    key: actionable.join("|"),
    message: sanitizeUserFacingCopy(actionable.slice(0, 2).join("；")),
    variant: "info",
  };
}
