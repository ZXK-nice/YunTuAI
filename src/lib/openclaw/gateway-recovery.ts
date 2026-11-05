import {
  cliGatewayHealthJson,
  type GatewayCliResult,
} from "./cli-bridge";
import { PRODUCT_NAME } from "../product-brand";
import { sanitizeUserFacingCopy, SERVICE_PATH_LABELS } from "../product-copy";
import { isTauriRuntime } from "../tauri-env";
import { useGatewayLifecycleStore } from "./gateway-lifecycle";
import { autoRecoverSupervisorGateway } from "./auto-supervisor-recovery";
import { parseHealthLooksOk, probeGatewayHealthLooksOk } from "./gateway-health-probe";
import { GATEWAY_RECOVERY_TIMEOUT_MS } from "./gateway-recovery-policy";
import {
  connectFailureReconnectDelayMs,
} from "./connection-resilience";

export type GatewayFailureFollowUp = "reconnect" | "reconnect_soon" | "none";

export type GatewayIncident = {
  at: number;
  /** 简短标题，用于页眉/提示 */
  title: string;
  /** 可读的「检测 / 已尝试 / 若仍失败」 */
  fullText: string;
  variant: "info" | "error";
};

type ConnectFailureContext = {
  error: unknown;
  autoRemediate: boolean;
  wsUrl: string;
  /** 当前是第几次重连尝试（0=首次连接） */
  reconnectAttempt: number;
};

type CloseFailureContext = {
  code: number;
  reason: string;
  autoRemediate: boolean;
  wsUrl: string;
  reconnectAttempt: number;
};

const REMEDIATE_COOLDOWN_MS = 2 * 60_000;
const MAX_REMEDIATE_PER_WINDOW = 2;
const WINDOW_MS = 5 * 60_000;
let remediates: { at: number }[] = [];

function recordRemediation(): void {
  const now = Date.now();
  remediates = remediates.filter((r) => now - r.at < WINDOW_MS);
  remediates.push({ at: now });
}

function canRemediate(): boolean {
  const now = Date.now();
  remediates = remediates.filter((r) => now - r.at < WINDOW_MS);
  return remediates.length < MAX_REMEDIATE_PER_WINDOW;
}

function lastRemediateAgo(): number {
  if (remediates.length === 0) return Infinity;
  return Date.now() - remediates[remediates.length - 1]!.at;
}

/** 启动后一段时间内，以及前几次重连，不弹出吓人的 1006/握手失败横幅。 */
const DEFAULT_STARTUP_GRACE_MS = 90_000;
let startupGraceMs = DEFAULT_STARTUP_GRACE_MS;
let appStartedAt = Date.now();

export function markGatewayRecoveryAppStart(): void {
  appStartedAt = Date.now();
}

/** 登录自启 / 刚开机时延长宽限期，与 Rust auto-ensure 延迟对齐。 */
export function applyLaunchStartupGrace(ms: number): void {
  if (Number.isFinite(ms) && ms > startupGraceMs) {
    startupGraceMs = ms;
  }
}

/** 启动宽限期内跳过自动回收/吓人横幅，避免与 Rust auto-ensure 叠加重型 IPC。 */
export function isInStartupGrace(): boolean {
  return Date.now() - appStartedAt < startupGraceMs;
}

export function __resetRemediateStateForTest(): void {
  remediates = [];
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS;
  appStartedAt = Date.now();
}

function inStartupGrace(): boolean {
  return Date.now() - appStartedAt < startupGraceMs;
}

function isQuietRecoveryAttempt(reconnectAttempt: number): boolean {
  return inStartupGrace() || reconnectAttempt < 3;
}

function quietReconnectResult(): HandlerResult {
  return {
    displayError: "正在自动重连本机服务…",
    incident: null,
    toasts: [],
    followUp: "reconnect_soon",
  };
}

/** 与 Dashboard 中 health 探测类似：用 ws URL 推 HTTP 本机基址，去掉 query */
/** 与 dashboard 的 health 探测习惯一致：把 ws 换成 http，并去掉 ?token= */
export function healthUrlFromGatewayWsUrl(wsUrl: string): string | null {
  const t = wsUrl.trim().split("?")[0];
  if (!t) return null;
  try {
    if (/^wss?:\/\//i.test(t)) {
      return t.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
    }
  } catch {
    /*  fallthrough  */
  }
  return t;
}

function isTokenMismatchMessage(msg: string): boolean {
  return /token_mismatch|auth_token_mismatch/i.test(msg);
}

/**
 * 连接阶段错误：无法建连、握手前关闭、握手拒绝等
 */
function classifyConnectMessage(msg: string): {
  key: "refused" | "timeout" | "policy" | "origin" | "rpc" | "rate_limited" | "token_mismatch" | "other";
  userHint: string;
} {
  const m = msg.toLowerCase();
  if (
    m.includes("rate_limited") ||
    m.includes("too many failed authentication") ||
    (m.includes("unauthorized") && m.includes("retry later"))
  ) {
    return {
      key: "rate_limited",
      userHint: "认证尝试过多，请等待约 30 秒后自动重连，勿频繁点击「连接」。",
    };
  }
  if (isTokenMismatchMessage(msg)) {
    return {
      key: "token_mismatch",
      userHint:
        "网关 Token 与服务环境配置不一致。本应用将自动重启本机服务；若仍失败，请删除系统里的网关 Token 环境变量后，在软件设置中重连。",
    };
  }
  if (
    m.includes("origin not allowed") ||
    m.includes("control_ui_origin") ||
    m.includes("allowedorigins")
  ) {
    return {
      key: "origin",
      userHint:
        `桌面端来源未列入 gateway.controlUi.allowedOrigins。本应用将尝试重启本机服务加载新配置；仍失败请升级 ${PRODUCT_NAME} 1.1.3+ 或在设置中手动重启服务。`,
    };
  }
  if (m.includes("auth_token_missing") || m.includes("gateway token missing") || m.includes("token missing")) {
    return {
      key: "policy",
      userHint: "未读取到网关 Token。请到「软件设置 → 本机服务」点「从 .env 重新加载」后重连。",
    };
  }
  if (m.includes("1008") || m.includes("拒绝握手") || m.includes("设备") || m.includes("认证") || m.includes("unauthorized")) {
    return {
      key: "policy",
      userHint: `请核对${SERVICE_PATH_LABELS.dataDir}/.env 中的 Token，并在软件设置 → 本机服务点「从 .env 重新加载」后重连。`,
    };
  }
  if (m.includes("握手超时") || m.includes("无法连接到本地服务") || m.includes("websocket")) {
    return {
      key: "refused",
      userHint: `请确认本机服务已启动，端口与 Token 与${SERVICE_PATH_LABELS.dataDir}/.env 一致。`,
    };
  }
  if (m.includes("connect.challenge") || m.includes("challenge")) {
    return {
      key: "policy",
      userHint: "可能需本机控制端/设备鉴权通过；勿经反向代理改写来源。",
    };
  }
  if (m.includes("rpc") || m.includes("json") || m.includes("parse")) {
    return {
      key: "rpc",
      userHint: "可能为网关与客户端协议/版本不兼容，请同时升级本应用与本机服务运行时。",
    };
  }
  return {
    key: "other",
    userHint: "保留下方完整错误，便于反馈或到「总览」运行 doctor。",
  };
}

function classifyClose(
  code: number,
  reason: string,
): { key: "normal" | "abnormal" | "policy" | "server"; userHint: string } {
  if (code === 1000 || (code === 1005 && !reason)) {
    return { key: "normal", userHint: "正常断开或代理/VPN 空闲超时，将快速重连。" };
  }
  if (code === 1008) {
    return {
      key: "policy",
      userHint: "服务策略拒绝，多为 Token/控制端/设备身份；见软件设置 → 本机服务中说明。",
    };
  }
  if (code === 1006 || code === 0) {
    return {
      key: "abnormal",
      userHint: "网络层中断或短暂抖动，本机服务很可能正常运行，直接快速重连。",
    };
  }
  if (code === 1011 || (code > 0 && code < 4000)) {
    return { key: "server", userHint: "对端或中间层异常，若反复出现请查看网关日志后重启服务。" };
  }
  return { key: "abnormal", userHint: "可查看网关或本机内存/磁盘，必要时在设置中重启本机服务。" };
}

let remediationInFlight = false;

async function wrapRemediationResult(
  method: "restart" | "start",
  result: GatewayCliResult | null,
): Promise<{ method: "restart" | "start"; result: GatewayCliResult | null }> {
  if (!result?.ok) return { method, result };
  const healthy = await probeGatewayHealthLooksOk();
  if (healthy) return { method, result };
  return {
    method,
    result: {
      ok: false,
      stdout: result.stdout,
      stderr: `${result.stderr}\nhealth probe failed after ${method}`.trim(),
      exitCode: result.exitCode ?? 1,
    },
  };
}

/** 测试用：恢复成功返回前必须过 health 探测。 */
export async function __wrapRemediationResultForTest(
  method: "restart" | "start",
  result: GatewayCliResult | null,
): Promise<{ method: "restart" | "start"; result: GatewayCliResult | null }> {
  return wrapRemediationResult(method, result);
}

async function tryStartOrRestartGateway(): Promise<{
  method: "restart" | "start";
  result: GatewayCliResult | null;
}> {
  if (!isTauriRuntime()) {
    return { method: "restart", result: null };
  }
  const ok = await Promise.race([
    autoRecoverSupervisorGateway({ force: true }),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), GATEWAY_RECOVERY_TIMEOUT_MS),
    ),
  ]);
  return {
    method: "restart",
    result: {
      ok,
      stdout: ok ? "recovered" : "",
      stderr: ok ? "" : "health probe failed after restart",
      exitCode: ok ? 0 : 1,
    },
  };
}

type HandlerResult = {
  displayError: string | null;
  incident: GatewayIncident | null;
  toasts: { message: string; variant: "info" | "error" }[];
  followUp: GatewayFailureFollowUp;
  /** 覆盖默认退避的重连等待（毫秒），常见于 rate_limited。 */
  reconnectDelayMs?: number;
};

function buildIncident(
  title: string,
  lines: { label: string; text: string }[],
  variant: "info" | "error",
): GatewayIncident {
  const fullText = sanitizeUserFacingCopy(lines.map((l) => `【${l.label}】${l.text}`).join("\n"));
  return { at: Date.now(), title: sanitizeUserFacingCopy(title), fullText, variant };
}

/**
 * 连接失败（含握手前异常）
 */
export async function runConnectFailureStrategy(ctx: ConnectFailureContext): Promise<HandlerResult> {
  const err = ctx.error;
  const msg = err instanceof Error ? err.message : String(err);
  const kind = classifyConnectMessage(msg);
  const toasts: { message: string; variant: "info" | "error" }[] = [];

  if (
    ctx.autoRemediate &&
    isQuietRecoveryAttempt(ctx.reconnectAttempt) &&
    (kind.key === "refused" || kind.key === "timeout" || kind.key === "other")
  ) {
    return quietReconnectResult();
  }

  if (kind.key === "rate_limited") {
    const canRestart = isTauriRuntime() && ctx.autoRemediate;
    if (canRestart) {
      await autoRecoverSupervisorGateway({ force: true }).catch(() => false);
    }
    const delay = canRestart
      ? 3_000
      : (connectFailureReconnectDelayMs(msg, ctx.reconnectAttempt) ?? 45_000);
    const lines: { label: string; text: string }[] = [
      {
        label: "检测",
        text: `本机服务认证限流（连续失败认证过多）${msg.length > 100 ? "：" + msg.slice(0, 100) + "…" : "：" + msg}`,
      },
      {
        label: "本应用",
        text: canRestart
          ? "已重启本机监管网关以清空限流计数，约 3 秒后自动重连。"
          : `将等待约 ${Math.ceil(delay / 1000)} 秒后自动重连，避免加剧限流。`,
      },
      { label: "请检查", text: kind.userHint },
    ];
    toasts.push({
      message: canRestart
        ? "本机服务认证限流，已重启本机服务，即将重连…"
        : `网关临时限流，约 ${Math.ceil(delay / 1000)} 秒后自动重连…`,
      variant: "info",
    });
    return {
      displayError: formatDisplayError(lines, msg),
      incident: buildIncident("本机服务：认证限流", lines, "info"),
      toasts,
      followUp: canRestart ? "reconnect_soon" : "reconnect",
      reconnectDelayMs: delay,
    };
  }

  let health: GatewayCliResult | null = null;
  let healthMode: "ok" | "down" | "unknown" = "unknown";
  if (isTauriRuntime()) {
    const hUrl = healthUrlFromGatewayWsUrl(ctx.wsUrl);
    health = await cliGatewayHealthJson(hUrl || ctx.wsUrl);
    healthMode = parseHealthLooksOk(health);
  }

  const lines: { label: string; text: string }[] = [
    { label: "检测", text: `连接失败（${kind.key}）` },
  ];

  if (isTauriRuntime() && health?.ok && health.stdout) {
    lines.push({ label: "本机", text: "CLI health 有输出；若与 WebSocket 仍矛盾，多属策略/认证或 URL 与端口不一致，而非进程未起。" });
  } else if (isTauriRuntime() && !health?.ok) {
    lines.push({ label: "本机", text: "CLI health/探测未通过或无法执行，可能本机版运行时未安装、未在 PATH，或本机服务卡住。" });
  }

  if (!isTauriRuntime() || !ctx.autoRemediate) {
    lines.push({ label: "本应用", text: "未执行自动恢复（非桌面或已关闭「连接异常时自动恢复」）。" });
    if (!ctx.autoRemediate) {
      toasts.push({ message: "本机服务连接失败。可在「软件设置 → 本机服务」打开自动恢复，或本机执行 重启本机服务 后点「连接服务」。", variant: "error" });
    } else {
      toasts.push({ message: "本机服务连接失败。请使用桌面版以启用本机健康检查与建议。", variant: "error" });
    }
    return {
      displayError: formatDisplayError(
        lines.concat([{ label: "请检查", text: kind.userHint }]),
        msg,
      ),
      incident: buildIncident("本机服务连接失败", lines.concat([{ label: "请检查", text: kind.userHint }]), "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  /* token_mismatch：重启监管网关以注入 .env Token（不受 policy 跳过限制） */
  if (kind.key === "token_mismatch" && isTauriRuntime() && ctx.autoRemediate && canRemediate()) {
    remediationInFlight = true;
    try {
      const { method, result } = await tryStartOrRestartGateway();
      if (result?.ok) {
        recordRemediation();
        lines.push({ label: "本应用", text: `已执行 gateway ${method}，以 服务数据目录 .env 重新加载 Token。` });
        toasts.push({ message: "已重启本机服务并同步 Token，正在重连…", variant: "info" });
        return {
          displayError: kind.userHint,
          incident: buildIncident("本机服务：Token 已同步", lines, "info"),
          toasts,
          followUp: "reconnect_soon",
        };
      }
      lines.push({ label: "本应用", text: "自动重启本机服务未成功，请手动在设置中重启服务。" });
    } finally {
      remediationInFlight = false;
    }
  }

  /* 策略/认证类不自动起停进程，避免与配置问题打架（origin / token_mismatch 除外） */
  const skipAutoService =
    kind.key !== "origin" &&
    kind.key !== "token_mismatch" &&
    (kind.key === "policy" ||
      (kind.key === "other" && /1008|拒绝|policy|auth|device/i.test(msg)));
  if (skipAutoService) {
    lines.push({ label: "本应用", text: "未自动重启本机服务，请按提示修正配置后重连。" });
    toasts.push({ message: "连接被拒绝，请检查 Token 后重连。", variant: "error" });
    return {
      displayError: kind.userHint,
      incident: buildIncident("本机服务：认证或策略", lines.concat([{ label: "请检查", text: kind.userHint }]), "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  if (kind.key === "refused" && healthMode === "ok") {
    lines.push({
      label: "本机",
      text: "CLI health 正常，但无法建立 WebSocket。多为 Token、控制端/设备鉴权、或本机回环经代理。不自动起停本机服务。",
    });
    toasts.push({
      message: `本机服务看似可达，但握手失败。请核对 Token 与${SERVICE_PATH_LABELS.dataDir}/.env，可试「恢复默认连接参数」后重连。`,
      variant: "error",
    });
    return {
      displayError: formatDisplayError(
        lines.concat([{ label: "请检查", text: kind.userHint }]),
        msg,
      ),
      incident: buildIncident("本机服务：握手/策略", lines.concat([{ label: "请检查", text: kind.userHint }]), "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  const likelyDown = kind.key === "refused" || (kind.key === "other" && /无法连接|econn|refused|connection/i.test(msg));
  const canTryService =
    (likelyDown || healthMode === "down" || (healthMode === "unknown" && !health?.ok)) && kind.key !== "rpc";

  if (!canTryService || !canRemediate() || lastRemediateAgo() < REMEDIATE_COOLDOWN_MS) {
    if (!canRemediate()) {
      lines.push({ label: "本应用", text: `5 分钟内已自动恢复 ${MAX_REMEDIATE_PER_WINDOW} 次，现暂停，避免与手动操作互相打架。` });
      toasts.push({ message: "自动恢复已暂停，请检查本机服务与端口后手动「启动/重启服务」并连接。", variant: "info" });
    } else if (lastRemediateAgo() < REMEDIATE_COOLDOWN_MS) {
      lines.push({ label: "本应用", text: "距上次自动恢复过近，已跳过，稍后将仅按退避重试重连。" });
    } else {
      lines.push({ label: "本应用", text: "当前类型未触发自动起停本机服务，仅退避重连。" });
    }
    const displayError = formatDisplayError(lines, msg);
    return {
      displayError,
      incident: buildIncident("本机服务连接失败", lines.concat([{ label: "请检查", text: kind.userHint }]), "error"),
      toasts: toasts.length ? toasts : [{ message: "连接失败。将按退避重试，或请手动在设置中起停本机服务。", variant: "error" }],
      followUp: "reconnect",
    };
  }

  if (remediationInFlight) {
    lines.push({ label: "本应用", text: "已有自动恢复在运行，本回合跳过。" });
    return {
      displayError: formatDisplayError(lines, msg),
      incident: buildIncident("本机服务：恢复中", lines, "info"),
      toasts: [{ message: "上一项自动恢复尚未结束，请稍候再试或手动点「连接服务」。", variant: "info" }],
      followUp: "reconnect",
    };
  }

  remediationInFlight = true;
  try {
    const { method, result } = await tryStartOrRestartGateway();
    if (result?.ok) {
      recordRemediation();
      lines.push({
        label: "本应用",
        text: `已执行 gateway ${method}，约 1s 后自动重连一次。`,
      });
      toasts.push({ message: `已尝试本机服务 ${method}，即将重连。`, variant: "info" });
      return {
        displayError: formatDisplayError(
          [
            ...lines,
            { label: "请检查", text: kind.key === "refused" ? "若仍失败请核对端口/Token 与 服务配置是否一致。" : kind.userHint },
          ],
          msg,
        ),
        incident: buildIncident("本机服务：已自动恢复", lines, "info"),
        toasts,
        followUp: "reconnect_soon",
      };
    }
    const detail = (result?.stderr || result?.stdout || "无输出").trim().slice(0, 240);
    lines.push({ label: "本应用", text: `已尝试本机服务 start/restart，未成功。详情：${detail}` });
    toasts.push({ message: `自动恢复未成功。${detail.slice(0, 120)}`, variant: "error" });
    return {
      displayError: formatDisplayError(lines, msg),
      incident: buildIncident("本机服务：自动恢复失败", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  } finally {
    remediationInFlight = false;
  }
}

function formatDisplayError(sections: { label: string; text: string }[], raw: string): string {
  const hint = sections.find((s) => s.label === "请检查");
  let out: string;
  if (hint?.text) out = hint.text;
  else {
    const app = sections.find((s) => s.label === "本应用");
    if (app?.text && !app.text.includes("未执行") && !app.text.includes("未做")) out = app.text;
    else if (raw.length <= 160) out = raw;
    else out = `${raw.slice(0, 160)}…`;
  }
  return sanitizeUserFacingCopy(out);
}

/**
 * 已握手后异常 close
 */
export async function runAbnormalCloseStrategy(ctx: CloseFailureContext): Promise<HandlerResult> {
  const c = classifyClose(ctx.code, ctx.reason);
  const reason = ctx.reason.trim() || "（无原因文本）";
  const toasts: { message: string; variant: "info" | "error" }[] = [];
  const lines: { label: string; text: string }[] = [
    { label: "检测", text: `WebSocket 已关闭 code=${ctx.code}，${c.key}。${reason}` },
  ];

  if (c.key === "normal" || c.key === "policy") {
    if (c.key === "policy") {
      toasts.push({ message: `本机服务断开（${ctx.code}）。${c.userHint}`, variant: "error" });
      lines.push({ label: "本应用", text: "将按退避重试重连。策略类不自动重启本机服务。" });
      lines.push({ label: "请检查", text: c.userHint });
    } else {
      /* 正常/空闲断开（1000/1005）：代理/VPN/路由器空闲超时，不应重启本机服务，立即快速重连 */
      toasts.push({ message: "连接已正常断开，将快速重连。", variant: "info" });
      lines.push({ label: "本应用", text: "正常/空闲断开，不重启本机服务，立即快速重连。" });
    }
    return {
      displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。${c.key === "policy" ? c.userHint : "将快速重连。"}`,
      incident: buildIncident("本机服务断开", lines, c.key === "policy" ? "error" : "info"),
      toasts,
      followUp: c.key === "normal" ? "reconnect_soon" : "reconnect",
    };
  }

  if (!isTauriRuntime() || !ctx.autoRemediate) {
    lines.push({ label: "本应用", text: "未做自动起停，仅重连；桌面版可开启「连接异常时自动恢复」以尝试本机 restart。" });
    toasts.push({ message: "本机服务连接中断，将重试。若常发生请检查网关进程。", variant: "error" });
    return {
      displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。${c.userHint}`,
      incident: buildIncident("本机服务断开", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  /* code 1006 / 0 = 网络层中断或握手后 error 事件，而非进程崩溃。
   * 本机服务几乎一定是健康的，不应执行 重启本机服务——那只会中断正在进行的会话。
   * 直接快速重连即可。 */
  if (
    ctx.code === 1006 ||
    (ctx.code === 0 && /post-handshake|WebSocket error/i.test(ctx.reason ?? ""))
  ) {
    if (ctx.autoRemediate && isQuietRecoveryAttempt(ctx.reconnectAttempt)) {
      return quietReconnectResult();
    }
    lines.push({
      label: "本应用",
      text:
        ctx.code === 0
          ? "握手后 WebSocket error（code=0），按短暂网络抖动处理，不重启本机服务。"
          : "code=1006 网络层断开（代理/VPN/长空闲超时），不重启本机服务，直接快速重连。",
    });
    return {
      displayError: "连接短暂中断，正在重连…",
      incident: null,
      toasts: [],
      followUp: "reconnect_soon",
    };
  }

  const hUrl = healthUrlFromGatewayWsUrl(ctx.wsUrl);
  const health = await cliGatewayHealthJson(hUrl || ctx.wsUrl);
  const looksOk = parseHealthLooksOk(health) === "ok";
  if (looksOk) {
    lines.push({ label: "本机", text: "CLI health 仍像正常，异常更像是会话层或短中断，不自动起停服务。" });
    toasts.push({ message: "连接已断开，但本机健康检查通过；将重试。若一直循环请查看网关与代理。", variant: "info" });
    return {
      displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。${c.userHint}`,
      incident: buildIncident("本机服务：短暂断开", lines, "info"),
      toasts,
      followUp: "reconnect",
    };
  }

  if (!canRemediate() || lastRemediateAgo() < REMEDIATE_COOLDOWN_MS) {
    lines.push({ label: "本应用", text: "本窗口内已多次自动恢复，此次仅退避重连，避免重复起停。" });
    toasts.push({ message: "本机服务异常断开，将重试。若需强制请手动「重启服务」。", variant: "error" });
    return {
      displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。`,
      incident: buildIncident("本机服务断开", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  if (c.key === "abnormal" || c.key === "server") {
    if (remediationInFlight) {
      toasts.push({ message: "连接断开，将重试。上一项服务恢复可能仍在进行。", variant: "info" });
      return {
        displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。`,
        incident: buildIncident("本机服务断开", lines, "info"),
        toasts,
        followUp: "reconnect",
      };
    }
    remediationInFlight = true;
    try {
      const { method, result } = await tryStartOrRestartGateway();
      if (result?.ok) {
        recordRemediation();
        lines.push({ label: "本应用", text: `健康不佳，已执行 gateway ${method}，约 1s 后重连。` });
        toasts.push({ message: "检测到本机服务异常，已尝试重启本机服务，即将重连。", variant: "info" });
        return {
          displayError: formatDisplayError(
            [
              ...lines,
              { label: "请检查", text: "若仍反复断开，请查看网关日志与系统资源，或到「设置」中手动起停本机服务。" },
            ],
            ctx.reason,
          ),
          incident: buildIncident("本机服务：已尝试恢复", lines, "info"),
          toasts,
          followUp: "reconnect_soon",
        };
      }
      const detail = (result?.stderr || result?.stdout || "").trim().slice(0, 200);
      lines.push({ label: "本应用", text: `尝试自动恢复失败。${detail}` });
      toasts.push({ message: "连接断开，自动重启本机服务未成功，请至设置手动操作。", variant: "error" });
      return {
        displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。`,
        incident: buildIncident("本机服务：恢复失败", lines, "error"),
        toasts,
        followUp: "reconnect",
      };
    } finally {
      remediationInFlight = false;
    }
  }

  lines.push({ label: "本应用", text: "将按退避重试重连。" });
  return {
    displayError: `连接已断开（${ctx.code}）${ctx.reason ? `：${ctx.reason}` : ""}。将自动重试。${c.userHint}`,
    incident: buildIncident("本机服务断开", lines, "error"),
    toasts: toasts.length ? toasts : [{ message: "本机服务连接中断，将重试。", variant: "error" }],
    followUp: "reconnect",
  };
}

type StallContext = {
  wsUrl: string;
  autoRemediate: boolean;
  /** 连续在连接上 `health` RPC 未成功或超时的次数 */
  consecutiveFailures: number;
  lastFailureMessage: string;
  monitorIntervalMs?: number;
};

/**
 * 已显示「已连接」，但本应用多次无法在时限内从 WebSocket 收到 `health` 的响应时调用。
 * 会对比本机 CLI health 并视情况起停 `gateway`（与全局限流共用）。
 */
export async function runGatewayStallNoResponseStrategy(ctx: StallContext): Promise<HandlerResult> {
  const lifecycle = useGatewayLifecycleStore.getState().snapshot;
  if (lifecycle?.processBusyLikely) {
    return {
      displayError: null,
      incident: buildIncident(
        "本机服务：任务进行中",
        [
          {
            label: "检测",
            text: "WebSocket health 暂未响应，但本机服务进程仍在运行，可能是大模型长任务占用。将保持连接并稍后重试 health。",
          },
        ],
        "info",
      ),
      toasts: [],
      followUp: "none",
    };
  }

  const toasts: { message: string; variant: "info" | "error" }[] = [];
  const hUrl = healthUrlFromGatewayWsUrl(ctx.wsUrl);
  const health = await cliGatewayHealthJson(hUrl || ctx.wsUrl);
  const healthMode = parseHealthLooksOk(health);
  const intervalSec = Math.round((ctx.monitorIntervalMs ?? 15_000) / 1000);
  const lines: { label: string; text: string }[] = [
    {
      label: "检测",
      text: `已连接，但本应用在 ${ctx.consecutiveFailures} 次 health 检查超时后触发恢复（单次 RPC 约 8s，间隔约 ${intervalSec}s）。${ctx.lastFailureMessage.replace(/\s+/g, " ").slice(0, 200)}`,
    },
    {
      label: "本机",
      text: `CLI 快速探测：${
        health?.ok
          ? "命令返回有输出。解析为 " + (healthMode === "ok" ? "正常倾向" : healthMode === "down" ? "异常倾向" : "需人工看输出")
          : "命令未通过或无法执行。可能本机版运行时不在 PATH。"
      }。${(health?.stdout || health?.stderr || "").trim().slice(0, 200)}`,
    },
  ];

  if (!isTauriRuntime() || !ctx.autoRemediate) {
    lines.push({
      label: "本应用",
      text: "未起停本机服务（非桌面或已关自动恢复）。将断开本连接并按退避重试重连。",
    });
    toasts.push({ message: "本机服务长时间无 health 回包。请使用桌面版并开启「连接异常时自动恢复」，或到设置中手动「重启服务」。", variant: "error" });
    return {
      displayError: formatDisplayError(
        lines.concat([{ label: "请检查", text: `若常发生，请查网关是否假死、CPU/磁盘、或到${SERVICE_PATH_LABELS.dataDir} 查看日志。` }]),
        ctx.lastFailureMessage,
      ),
      incident: buildIncident("本机服务：长时无响应", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  if (remediationInFlight) {
    toasts.push({ message: "上一项本机服务恢复未结束。若仍无响应，请稍候再试。", variant: "info" });
    return {
      displayError: formatDisplayError(
        lines.concat([{ label: "本应用", text: "已有自动恢复在运行，本回合不重复起停。" }]),
        ctx.lastFailureMessage,
      ),
      incident: buildIncident("本机服务：长时无响应", lines, "info"),
      toasts,
      followUp: "reconnect",
    };
  }

  if (!canRemediate() || lastRemediateAgo() < REMEDIATE_COOLDOWN_MS) {
    lines.push({ label: "本应用", text: "自动起停本窗口内已用尽或处于冷却。仅断开重连，避免反复 restart。" });
    toasts.push({ message: "长时无响应。自动恢复已暂停，请至设置中手动起停本机服务。", variant: "info" });
    return {
      displayError: formatDisplayError(lines, ctx.lastFailureMessage),
      incident: buildIncident("本机服务：长时无响应", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  }

  /* WS 不响应但本机常仍显示 ok：仍允许一次本机 start/restart 清假死，但走同一限流 */
  const reason = healthMode === "ok" ? "WS 与 CLI 结果不一致或进程假死" : "健康探测不利";

  lines.push({ label: "本应用", text: `将因「${reason}」尝试本机服务启动/重启一次。` });
  toasts.push({ message: "检测到长时无响应。正在起停本机服务，约 1s 后重连。", variant: "info" });

  remediationInFlight = true;
  try {
    const { method, result } = await tryStartOrRestartGateway();
    if (result?.ok) {
      recordRemediation();
      lines.push({ label: "本应用", text: `已执行 gateway ${method}，将立刻断开旧连接并短延迟重连。` });
      toasts.push({ message: `长时无响应后已本机执行 gateway ${method}。`, variant: "info" });
      return {
        displayError: formatDisplayError(
          [
            ...lines,
            { label: "请检查", text: "若仍无回复，请检查本机服务与模型服务（CPU/显存/接口限流）。" },
          ],
          ctx.lastFailureMessage,
        ),
        incident: buildIncident("本机服务：长时无响应后已起停", lines, "info"),
        toasts,
        followUp: "reconnect_soon",
      };
    }
    const detail = (result?.stderr || result?.stdout || "").trim().slice(0, 200);
    lines.push({ label: "本应用", text: `起停本机服务未成功。${detail}` });
    toasts.push({ message: "长时无响应后自动起停本机未成功。请至设置中手动处理。", variant: "error" });
    return {
      displayError: formatDisplayError(
        lines.concat([{ label: "请检查", text: `请检查 PATH、权限及${SERVICE_PATH_LABELS.dataDir} 配置与日志。` }]),
        ctx.lastFailureMessage,
      ),
      incident: buildIncident("本机服务：长时无响应，恢复未成功", lines, "error"),
      toasts,
      followUp: "reconnect",
    };
  } finally {
    remediationInFlight = false;
  }
}

let lastToastKey = "";
let lastToastAt = 0;
const TOAST_DEBOUNCE_MS = 20_000;

export function applyGatewayToasts(
  toasts: { message: string; variant: "info" | "error" }[],
  show: (m: string, v?: "info" | "error" | "success") => void,
): void {
  const now = Date.now();
  for (const t of toasts) {
    const key = `${t.variant}:${t.message}`;
    if (key === lastToastKey && now - lastToastAt < TOAST_DEBOUNCE_MS) continue;
    lastToastKey = key;
    lastToastAt = now;
    show(t.message, t.variant);
  }
}