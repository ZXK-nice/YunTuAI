/** 首启/连接等待屏：对用户隐藏 Rust provision 阶段技术词。 */

const PROVISION_STEP_INDEX: Record<string, number> = {
  prepare: 1,
  download: 1,
  extract: 2,
  npm: 2,
  finalize: 3,
  configure: 3,
  control: 4,
  verify: 4,
  skills: 5,
  done: 5,
};

export const READINESS_MAIN_TITLE = "正在准备云图";
export const READINESS_TIME_HINT = "通常 15 秒～1 分钟，请勿关闭";
export const READINESS_DONE_HINT =
  "准备完成后可正常使用；关闭窗口会缩到托盘，任务可在后台继续。";

export function userProvisionPhaseLabel(phase: string, percent?: number): string {
  const step = PROVISION_STEP_INDEX[phase] ?? 2;
  const pct = typeof percent === "number" ? Math.min(100, Math.max(0, percent)) : undefined;
  if (phase === "done" || pct === 100) return "准备完成";
  return `正在准备（${step}/5）`;
}

export function userLifecyclePhaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "healthy":
      return "准备完成";
    case "starting":
      return "正在准备（4/5）";
    case "preparing":
      return "正在准备（1/5）";
    case "degraded":
      return "正在恢复";
    case "failed":
      return "准备遇到问题";
    default:
      return "正在准备";
  }
}

export function sanitizeReadinessDetail(detail: string): string {
  const t = detail.trim();
  if (!t) return "正在配置本机办公能力，请稍候…";
  if (/管控|npm install|provision|openclaw|gateway/i.test(t)) {
    return "正在准备，请稍候…";
  }
  return t;
}
