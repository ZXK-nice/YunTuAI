import { PRODUCT_NAME } from "./product-brand";

/**
 * 用户可见文案：YunTu Control 内置本机服务的一体化表述。
 */
export const RUNTIME_SOURCE_LABELS = {
  bundled: `${PRODUCT_NAME} 内置版`,
  bundledShort: "内置版",
  global: "本机已安装版",
  globalShort: "本机版",
  auto: "自动",
  unknown: "未选择",
} as const;

export function runtimeSourceLabel(source?: string | null): string {
  switch (source) {
    case "global":
      return RUNTIME_SOURCE_LABELS.global;
    case "bundled":
      return RUNTIME_SOURCE_LABELS.bundled;
    case "auto":
      return RUNTIME_SOURCE_LABELS.auto;
    default:
      return RUNTIME_SOURCE_LABELS.unknown;
  }
}

export function runtimeSourceShortLabel(source: "bundled" | "global"): string {
  return source === "global" ? RUNTIME_SOURCE_LABELS.globalShort : RUNTIME_SOURCE_LABELS.bundledShort;
}

/** 实际磁盘路径（支持排障，勿直接渲染给普通用户） */
export const SERVICE_PATHS = {
  dataDir: "openclaw-data",
  configFile: "openclaw.json",
  envFile: "openclaw-data/.env",
  runtimeDir: "openclaw-portable",
} as const;

/** 用户界面中的友好名称（不含第三方运行时品牌） */
export const SERVICE_PATH_LABELS = {
  dataDir: "服务数据目录",
  configFile: "服务配置文件",
  envFile: "服务环境配置（.env）",
  runtimeDir: "内置运行时",
} as const;

export const SETTINGS_NAV = {
  root: "软件设置",
  service: "本机服务",
  servicePath: "软件设置 → 本机服务",
} as const;

/**
 * 将后端/网关原文中的第三方运行时品牌与技术路径名替换为用户友好表述。
 * 不修改协议字段、文件名匹配逻辑，仅用于展示层。
 */
export function sanitizeUserFacingCopy(text: string): string {
  if (!text) return text;
  let out = text;
  // 先处理路径/入口/环境变量（必须在品牌词之前，避免 openclaw-data 被截成「本机服务-data」）
  out = out.replace(/OPENCLAW_GATEWAY_TOKEN/g, "服务令牌");
  out = out.replace(/OPENCLAW_GATEWAY_PORT/g, "本机服务端口");
  out = out.replace(/OPENCLAW_GATEWAY_HOST/g, "本机服务主机");
  out = out.replace(/\bOPENCLAW_[A-Z0-9_]+\b/g, "服务环境变量");
  out = out.replace(/npm install openclaw/gi, "npm install 本机服务组件");
  out = out.replace(/openclaw\.mjs/gi, "服务入口脚本");
  out = out.replace(/openclaw\.cmd/gi, "服务启动脚本");
  out = out.replace(/openclaw-data[\\/]\.env/gi, `${SERVICE_PATH_LABELS.dataDir}/.env`);
  out = out.replace(/openclaw-portable-payload\.zip/gi, "内置运行时安装包");
  out = out.replace(/openclaw-portable/gi, SERVICE_PATH_LABELS.runtimeDir);
  out = out.replace(/openclaw-bundled/gi, "内置");
  out = out.replace(/openclaw\.json/gi, SERVICE_PATH_LABELS.configFile);
  out = out.replace(/openclaw-data/gi, SERVICE_PATH_LABELS.dataDir);
  out = out.replace(/~\/\.openclaw/g, "旧版用户目录");
  out = out.replace(/\.openclaw\b/gi, "旧版用户目录");
  out = out.replace(/openclawVersion/gi, "服务版本");
  out = out.replace(/Gateway failed to start/gi, "本机服务启动失败");
  out = out.replace(/Invalid config at/gi, "服务配置文件无效：");
  out = out.replace(/browser\.profiles\.[^\s:]+/gi, "浏览器配置");
  out = out.replace(/Run "openclaw doctor --fix"[^.]*\./gi, "可在「软件设置 → 本机服务」点击「修复服务配置」。");
  out = out.replace(/openclaw doctor --fix/gi, "修复服务配置");
  out = out.replace(/stability bundle/gi, "诊断包");
  out = out.replace(/gateway\.startup_failed/gi, "服务启动失败");
  out = out.replace(/\bOpen[\s_-]Claw\b/gi, "本机服务");
  out = out.replace(/\bOpenClaw\b/g, "本机服务");
  out = out.replace(/小龙虾/g, "本机服务");
  // 兜底：残留单词 openclaw（不会再碰到已替换的路径段）
  out = out.replace(/\bopenclaw\b/gi, "本机服务");
  out = out.replace(/(?<!:)\b18789\b/g, "本机服务端口");
  out = out.replace(/本机网关/g, "本机服务");
  out = out.replace(/外部网关/g, "外部服务");
  out = out.replace(/监管网关/g, "本机服务");
  out = out.replace(/网关/g, "本机服务");
  out = out.replace(/\bGateway\b/g, "本机服务");
  while (out.includes("本机服务本机服务")) {
    out = out.replace(/本机服务本机服务/g, "本机服务");
  }
  return out;
}

/** 展示磁盘路径时脱敏品牌段（保留盘符与层级可读性）。 */
export function formatUserFacingPath(path: string | null | undefined): string {
  if (!path) return "—";
  return sanitizeUserFacingCopy(path);
}
