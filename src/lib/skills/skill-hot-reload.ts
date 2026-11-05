/**
 * 技能热刷新：优先通过网关 RPC + 目录 watch 标记生效，失败再回退网关重启。
 */
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import { getGatewayClient } from "../openclaw/gateway-runtime";
import { fetchGatewaySkillStatus } from "../openclaw/gateway-tools";
import { extractGatewayMethodsList } from "../openclaw/gateway-method-coverage";
import type { SkillInstallReloadResult } from "./skill-install-reload";

export type SkillHotReloadOpts = {
  /** 安装后期望能在 skills.status 中看到该技能名 */
  expectedSkillName?: string;
};

async function touchSkillsWatchMarker(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invokeAuthed("openclaw_touch_skills_watch", {});
  } catch {
    /* 非致命 */
  }
}

async function probeSkillsStatus(refreshParams?: Record<string, unknown>): Promise<boolean> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return false;
  try {
    await client.request("skills.status", refreshParams ?? {}, { timeoutMs: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/** 轻量热刷新：仅 touch + skills.reload，不做前后对比（设置页开关用）。 */
export async function quickHotReloadGatewaySkills(): Promise<void> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return;

  await touchSkillsWatchMarker();

  try {
    const methodsRaw = await client.request("list_methods", {}, { timeoutMs: 4_000 });
    const methods = extractGatewayMethodsList(methodsRaw).map((m) => m.toLowerCase());
    if (methods.includes("skills.reload")) {
      await client.request("skills.reload", {}, { timeoutMs: 12_000 });
      return;
    }
  } catch {
    /* fallback below */
  }

  await probeSkillsStatus({ refresh: true });
}

/** 尝试不重启 Gateway 刷新技能索引。 */
export async function tryHotReloadSkills(opts?: SkillHotReloadOpts): Promise<SkillInstallReloadResult> {
  const client = getGatewayClient();
  if (!client.isHelloOk) {
    return { gatewayRestarted: false, skillsStatusOk: false, message: "本机服务未连接，无法热刷新" };
  }

  const before = await fetchGatewaySkillStatus();
  await touchSkillsWatchMarker();

  let invokedReload = false;
  try {
    const methodsRaw = await client.request("list_methods", {}, { timeoutMs: 8_000 });
    const methods = extractGatewayMethodsList(methodsRaw).map((m) => m.toLowerCase());
    if (methods.includes("skills.reload")) {
      await client.request("skills.reload", {}, { timeoutMs: 30_000 });
      invokedReload = true;
    }
  } catch {
    /* 继续尝试其他路径 */
  }

  if (!invokedReload) {
    const refreshAttempts: Record<string, unknown>[] = [{ refresh: true }, { reload: true }, {}];
    for (const params of refreshAttempts) {
      if (await probeSkillsStatus(params)) break;
    }
    try {
      await client.request("skills.bins", {}, { timeoutMs: 12_000 });
    } catch {
      /* 部分网关无此方法 */
    }
  }

  await new Promise((r) => setTimeout(r, invokedReload ? 400 : 900));

  const after = await fetchGatewaySkillStatus();
  const skillsStatusOk = await probeSkillsStatus({});
  const expected = opts?.expectedSkillName?.trim();
  const expectedFound = expected
    ? after.some((s) => s.name === expected || s.name.endsWith(`/${expected}`))
    : true;
  const countIncreased = after.length >= before.length;

  if (skillsStatusOk && expectedFound && (countIncreased || after.length > 0)) {
    return {
      gatewayRestarted: false,
      skillsStatusOk: true,
      message: expected
        ? `技能「${expected}」已热刷新生效（无需重启本机服务）`
        : "技能已热刷新（无需重启本机服务）",
    };
  }

  return {
    gatewayRestarted: false,
    skillsStatusOk: false,
    message: expected && !expectedFound
      ? `热刷新后未在技能列表中找到「${expected}」，将尝试重启本机服务`
      : "热刷新未确认生效，将尝试重启本机服务",
  };
}
