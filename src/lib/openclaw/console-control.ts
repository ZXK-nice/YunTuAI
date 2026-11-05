/**
 * OpenClaw 控制台写操作 — 统一超时、连接检查与错误格式。
 * 不触发网关 stop/restart，避免破坏 YunTuAI 监管稳定性。
 */

import { getGatewayClient } from "./gateway-runtime";
import { buildAgentDeleteRpcParams } from "./agent-rpc";
import { buildSessionRpcKeyParams } from "./session-rpc";
import {
  getCachedDistributionProfile,
  probeGatewayAfterControlMutation,
  validateConfigPatchForProfile,
} from "./console-control-stability";

export type ControlResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

const controlInFlight = new Map<string, Promise<ControlResult>>();

function controlKey(method: string, params: Record<string, unknown>): string {
  return `${method}:${JSON.stringify(params)}`;
}

export function assertGatewayReady(): void {
  const client = getGatewayClient();
  if (!client.isHelloOk) {
    throw new Error("请先连接 Gateway");
  }
}

export async function controlRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts?: { timeoutMs?: number; singleFlight?: boolean; skipPostProbe?: boolean },
): Promise<ControlResult<T>> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const key = opts?.singleFlight ? controlKey(method, params) : "";

  const run = async (): Promise<ControlResult<T>> => {
    try {
      assertGatewayReady();
      const client = getGatewayClient();
      const data = (await client.request(method, params, { timeoutMs })) as T;
      if (!opts?.skipPostProbe && method !== "health" && method !== "status") {
        void probeGatewayAfterControlMutation();
      }
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  if (!key) return run();

  const existing = controlInFlight.get(key);
  if (existing) return existing as Promise<ControlResult<T>>;

  const p = run().finally(() => {
    controlInFlight.delete(key);
  });
  controlInFlight.set(key, p);
  return p;
}

// ── Cron ─────────────────────────────────────────────

export async function cronAdd(job: Record<string, unknown>) {
  return controlRequest("cron.add", job, { timeoutMs: 60_000 });
}

export async function cronRemove(id: string) {
  return controlRequest("cron.remove", { id: id.trim() }, { singleFlight: true });
}

export async function cronRun(id: string) {
  return controlRequest("cron.run", { id: id.trim() }, { timeoutMs: 120_000, singleFlight: true });
}

export async function cronUpdate(id: string, patch: Record<string, unknown>) {
  return controlRequest("cron.update", { id: id.trim(), ...patch }, { timeoutMs: 60_000 });
}

// ── Node / Device pairing ────────────────────────────

export async function nodePairApprove(id: string) {
  return controlRequest("node.pair.approve", { id: id.trim() }, { singleFlight: true });
}

export async function nodePairReject(id: string) {
  return controlRequest("node.pair.reject", { id: id.trim() }, { singleFlight: true });
}

export async function devicePairApprove(id: string) {
  return controlRequest("device.pair.approve", { id: id.trim() }, { singleFlight: true });
}

export async function devicePairReject(id: string) {
  return controlRequest("device.pair.reject", { id: id.trim() }, { singleFlight: true });
}

export async function devicePairRemove(id: string) {
  return controlRequest("device.pair.remove", { id: id.trim() }, { singleFlight: true });
}

// ── Config ───────────────────────────────────────────

export async function configPatch(patch: Record<string, unknown>) {
  const profile = await getCachedDistributionProfile();
  const blocked = validateConfigPatchForProfile(patch, profile);
  if (blocked) return { ok: false, error: blocked };
  return controlRequest("config.patch", { patch }, { timeoutMs: 120_000, singleFlight: true });
}

export async function configApply() {
  return controlRequest("config.apply", {}, { timeoutMs: 120_000, singleFlight: true });
}

// ── Agents ─────────────────────────────────────────

export async function agentsUpdate(params: Record<string, unknown>) {
  return controlRequest("agents.update", params, { timeoutMs: 60_000, singleFlight: true });
}

export async function agentsDelete(agentId: string) {
  return controlRequest("agents.delete", buildAgentDeleteRpcParams(agentId), {
    timeoutMs: 60_000,
    singleFlight: true,
  });
}

// ── Sessions (gateway side) ──────────────────────────

export async function gatewaySessionDelete(sessionKey: string) {
  return controlRequest("sessions.delete", buildSessionRpcKeyParams(sessionKey), { singleFlight: true });
}

export async function gatewaySessionReset(sessionKey: string) {
  return controlRequest("sessions.reset", buildSessionRpcKeyParams(sessionKey), { singleFlight: true });
}

export async function gatewaySessionCompact(sessionKey: string) {
  return controlRequest("sessions.compact", buildSessionRpcKeyParams(sessionKey), {
    timeoutMs: 120_000,
    singleFlight: true,
  });
}

// ── Channels ───────────────────────────────────────

export async function channelLogout(channel: string) {
  return controlRequest("channels.logout", { channel: channel.trim() }, { singleFlight: true });
}

// ── Skills ─────────────────────────────────────────

export async function skillsUpdate(name: string, patch: Record<string, unknown>) {
  return controlRequest("skills.update", { name: name.trim(), ...patch }, { singleFlight: true });
}

// ── Memory doctor ────────────────────────────────────

export async function memoryDoctorStatus() {
  return controlRequest("doctor.memory.status", {}, { timeoutMs: 45_000 });
}

export async function memoryDoctorRepair() {
  return controlRequest("doctor.memory.repairDreamingArtifacts", {}, { timeoutMs: 120_000, singleFlight: true });
}

// ── Gateway update ───────────────────────────────────

export async function gatewaySelfUpdate() {
  return controlRequest("update.run", {}, { timeoutMs: 300_000, singleFlight: true });
}

// ── TTS / Voice ──────────────────────────────────────

export async function ttsStatus() {
  return controlRequest("tts.status", {}, { timeoutMs: 30_000, skipPostProbe: true });
}

export async function ttsEnable() {
  return controlRequest("tts.enable", {}, { singleFlight: true });
}

export async function ttsDisable() {
  return controlRequest("tts.disable", {}, { singleFlight: true });
}

export async function ttsSetProvider(provider: string) {
  return controlRequest("tts.setProvider", { provider: provider.trim() }, { singleFlight: true });
}

export async function voiceWakeGet() {
  return controlRequest("voicewake.get", {}, { timeoutMs: 20_000, skipPostProbe: true });
}

export async function voiceWakeSet(enabled: boolean) {
  return controlRequest("voicewake.set", { enabled }, { singleFlight: true });
}

// ── Exec approvals policy ────────────────────────────

export async function execApprovalsGet() {
  return controlRequest("exec.approvals.get", {}, { timeoutMs: 30_000, skipPostProbe: true });
}

export async function execApprovalsSet(policy: Record<string, unknown>) {
  return controlRequest("exec.approvals.set", policy, { timeoutMs: 60_000, singleFlight: true });
}

// ── Session compaction ───────────────────────────────

export async function compactionList(sessionKey: string) {
  return controlRequest(
    "sessions.compaction.list",
    buildSessionRpcKeyParams(sessionKey),
    { timeoutMs: 45_000, skipPostProbe: true },
  );
}

export async function compactionGet(sessionKey: string, branchId: string) {
  return controlRequest("sessions.compaction.get", {
    ...buildSessionRpcKeyParams(sessionKey),
    branchId: branchId.trim(),
  });
}

export async function compactionBranch(sessionKey: string, label?: string) {
  return controlRequest(
    "sessions.compaction.branch",
    {
      ...buildSessionRpcKeyParams(sessionKey),
      ...(label?.trim() ? { label: label.trim() } : {}),
    },
    { timeoutMs: 120_000, singleFlight: true },
  );
}

export async function compactionRestore(sessionKey: string, branchId: string) {
  return controlRequest(
    "sessions.compaction.restore",
    {
      ...buildSessionRpcKeyParams(sessionKey),
      branchId: branchId.trim(),
    },
    { timeoutMs: 120_000, singleFlight: true },
  );
}
