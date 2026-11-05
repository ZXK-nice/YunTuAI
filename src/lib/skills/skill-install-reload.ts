/**
 * 技能安装后刷新网关，使 openclaw.json / 技能目录变更生效。
 * 优先热刷新（免重启），失败再回退 supervisor 重启。
 */
import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";
import { connectWithFeedback } from "../connect-with-feedback";
import { getGatewayClient } from "../openclaw/gateway-runtime";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useSessionStore } from "../../stores/sessionStore";
import { notifyGatewayRestartPending } from "../openclaw/gateway-restart-notice";
import { tryHotReloadSkills, type SkillHotReloadOpts } from "./skill-hot-reload";

export type SkillInstallReloadResult = {
  gatewayRestarted: boolean;
  skillsStatusOk: boolean;
  /** 是否通过热刷新完成（未重启网关） */
  hotReloaded?: boolean;
  message: string;
};

export type SkillInstallReloadOpts = SkillHotReloadOpts & {
  /** 跳过热刷新，直接重启网关（故障恢复用） */
  forceGatewayRestart?: boolean;
};

/** 技能变更后刷新：先热加载，必要时再重启网关并重连。 */
export async function reloadGatewayAfterSkillInstall(
  opts?: SkillInstallReloadOpts,
): Promise<SkillInstallReloadResult> {
  if (!isTauriRuntime()) {
    return { gatewayRestarted: false, skillsStatusOk: false, message: "非桌面环境" };
  }

  if (useSessionStore.getState().isSending) {
    return {
      gatewayRestarted: false,
      skillsStatusOk: false,
      message: "当前有消息正在发送，技能已写入工作区；请待发送完成后再手动刷新技能",
    };
  }

  if (!opts?.forceGatewayRestart) {
    const hot = await tryHotReloadSkills(opts);
    if (hot.skillsStatusOk) {
      return { ...hot, hotReloaded: true };
    }
  }

  const gw = useGatewayStore.getState();
  gw.cancelReconnect();
  notifyGatewayRestartPending("技能更新");

  let gatewayRestarted = false;
  try {
    await invokeAuthed("gateway_supervisor_restart", {});
    gatewayRestarted = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { gatewayRestarted: false, skillsStatusOk: false, message: `网关重启失败：${msg}` };
  }

  try {
    await connectWithFeedback("技能安装后重连", { skipPrepare: true });
  } catch {
    /* connect 失败时继续探测 */
  }

  const client = getGatewayClient();
  for (let i = 0; i < 40; i++) {
    if (client.isHelloOk && useGatewayStore.getState().connState === "connected") break;
    await new Promise((r) => setTimeout(r, 500));
    if (i === 10 || i === 25) {
      try {
        await connectWithFeedback("技能安装后重连", { skipPrepare: true });
      } catch {
        /* retry */
      }
    }
  }

  let skillsStatusOk = false;
  try {
    if (client.isHelloOk) {
      await client.request("skills.status", {}, { timeoutMs: 30_000 });
      skillsStatusOk = true;
    }
  } catch {
    skillsStatusOk = false;
  }

  const connected = useGatewayStore.getState().connState === "connected" && client.isHelloOk;

  return {
    gatewayRestarted,
    skillsStatusOk,
    hotReloaded: false,
    message: skillsStatusOk
      ? "技能已安装并已重启本机服务"
      : connected
        ? "技能已安装，本机服务已重连（技能列表探测未确认，可稍后在工具页查看）"
        : gatewayRestarted
          ? "技能已安装，本机服务已重启但尚未重连；请到「软件设置 → 本机服务」手动连接"
          : "技能已写入工作区",
  };
}
