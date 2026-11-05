import { useCallback, useEffect, useState } from "react";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { useUiStore } from "../../stores/uiStore";
import { useAgentStore } from "../../stores/agentStore";
import { useSessionStore } from "../../stores/sessionStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { sanitizeUserFacingCopy } from "../../lib/product-copy";
import { findLocalSessionByRemoteKey } from "../../lib/openclaw/session-key-match";
import { getGatewayClient } from "../../lib/openclaw/gateway-runtime";
import {
  channelLogout,
  configApply,
  configPatch,
  cronAdd,
  cronRemove,
  cronRun,
  cronUpdate,
  devicePairApprove,
  devicePairReject,
  devicePairRemove,
  gatewaySelfUpdate,
  gatewaySessionDelete,
  gatewaySessionReset,
  memoryDoctorRepair,
  nodePairApprove,
  nodePairReject,
  skillsUpdate,
  ttsDisable,
  ttsEnable,
  ttsSetProvider,
  ttsStatus,
  voiceWakeGet,
  voiceWakeSet,
  execApprovalsGet,
  execApprovalsSet,
  compactionList,
  compactionBranch,
  compactionRestore,
  compactionGet,
} from "../../lib/openclaw/console-control";
import {
  fetchConsoleChannels,
  fetchConsoleConfig,
  fetchConsoleCron,
  fetchConsoleMemory,
  fetchConsoleNodes,
  fetchConsoleOverview,
  fetchConsoleSessions,
  fetchConsoleSkills,
  fetchConsoleUsage,
  formatRpcResultForDisplay,
} from "../../lib/openclaw/console-rpc";
import {
  parseCronJobs,
  parseGatewaySessions,
  parsePairRequests,
  parseSkillStatus,
  parseCompactionBranches,
  summarizeUsage,
  unwrapRecord,
} from "../../lib/openclaw/console-parse";
import { INTERNAL_PROFILE_LABEL, profileDisplayLabel } from "../../lib/distribution-profile";
import { getCachedDistributionProfile } from "../../lib/openclaw/console-control-stability";
import { deleteAgent, isAgentDeletable, updateAgent } from "../../lib/openclaw/agent-rpc";
import { installGatewaySkill } from "../../lib/openclaw/skills-bridge";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import {
  ConsoleJsonPreview,
  ConsoleMiniBtn,
  ConsoleRow,
  ConsoleSectionFrame,
} from "./ConsoleSectionFrame";

type SectionProps = { connState: GatewayConnStateWord; focusSessionKey?: string };

function useControlAction() {
  const showToast = useUiStore((s) => s.showToast);
  const [acting, setActing] = useState(false);

  const run = useCallback(
    async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) => {
      if (acting) return;
      setActing(true);
      try {
        const res = await fn();
        if (res.ok) {
          showToast(`${label}成功`, "success");
          onOk?.();
        } else {
          showToast(`${label}失败：${res.error ?? "未知错误"}`, "error");
        }
      } finally {
        setActing(false);
      }
    },
    [acting, showToast],
  );

  return { acting, run };
}

export function ConsoleOverviewSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const { acting, run } = useControlAction();
  const gatewayCapabilities = useGatewayStore((s) => s.gatewayCapabilities);
  const healthLatencyMs = useGatewayStore((s) => s.healthLatencyMs);
  const connectionQuality = useGatewayStore((s) => s.connectionQuality);
  const lastError = useGatewayStore((s) => s.lastError);
  const reconnectAttempt = useGatewayStore((s) => s.reconnectAttempt);

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleOverview();
      setData(rows);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="本机服务健康、身份与用量概览"
      busy={busy}
      onRefresh={() => void refresh()}
      actions={
        <ConsoleMiniBtn
          label="检查更新"
          variant="primary"
          disabled={acting || connState !== "connected"}
          onClick={() =>
            void run("服务更新", () => gatewaySelfUpdate(), () => void refresh())
          }
        />
      }
    >
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            连接：<strong className="text-[var(--text-primary)]">{connState}</strong>
          </span>
          {healthLatencyMs != null && <span>health {healthLatencyMs}ms</span>}
          <span>质量 {connectionQuality}</span>
          {reconnectAttempt > 0 && <span>重连 {reconnectAttempt} 次</span>}
        </div>
        {gatewayCapabilities?.gatewayVersion && (
          <div className="mt-1">本机服务 {sanitizeUserFacingCopy(gatewayCapabilities.gatewayVersion)}</div>
        )}
        {gatewayCapabilities?.methodCoverage && (
          <div className="mt-1">
            RPC 集成覆盖 {gatewayCapabilities.methodCoverage.integratedPresentCount}/
            {gatewayCapabilities.methodCoverage.integratedCount}（
            {gatewayCapabilities.methodCoverage.coveragePercent}%）
          </div>
        )}
        {lastError && (
          <div className="mt-1 text-[color-mix(in_oklab,var(--color-error)_80%,var(--text-secondary))]">
            最近错误：{sanitizeUserFacingCopy(lastError)}
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {Array.isArray(data) &&
          data.map((r) => (
            <ConsoleJsonPreview key={(r as { method: string }).method} data={formatRpcResultForDisplay(r as never)} />
          ))}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleCronSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState(parseCronJobs([]));
  const [newId, setNewId] = useState("");
  const [newSchedule, setNewSchedule] = useState("0 9 * * *");
  const [newPayload, setNewPayload] = useState('{"message":"hello"}');
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleCron();
      const listRow = rows.find((r) => r.method === "cron.list");
      setJobs(parseCronJobs(listRow?.ok ? listRow.data : []));
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const addJob = () => {
    const id = newId.trim();
    if (!id) return;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(newPayload) as Record<string, unknown>;
    } catch {
      useUiStore.getState().showToast("Payload 必须是合法 JSON", "error");
      return;
    }
    void run(
      "添加定时任务",
      () => cronAdd({ id, schedule: newSchedule.trim(), ...payload }),
      () => void refresh(),
    );
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="管理 Cron 定时任务：添加、启用/禁用、手动运行、删除"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
        <div className="text-xs font-medium text-[var(--text-primary)]">添加任务</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            className="yt-input text-xs"
            placeholder="任务 ID"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <input
            className="yt-input text-xs"
            placeholder="Cron 表达式"
            value={newSchedule}
            onChange={(e) => setNewSchedule(e.target.value)}
          />
        </div>
        <textarea
          className="yt-input min-h-[4rem] font-mono text-[10px]"
          value={newPayload}
          onChange={(e) => setNewPayload(e.target.value)}
        />
        <ConsoleMiniBtn label="添加" variant="primary" disabled={acting} onClick={addJob} />
      </div>
      <div className="flex flex-col gap-2 overflow-auto">
        {jobs.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">暂无定时任务</p>
        ) : (
          jobs.map((j) => (
            <ConsoleRow
              key={j.id}
              title={j.label ?? j.id}
              subtitle={[j.schedule, j.enabled === false ? "已禁用" : "启用"].filter(Boolean).join(" · ")}
            >
              <ConsoleMiniBtn
                label="运行"
                disabled={acting}
                onClick={() => void run(`运行 ${j.id}`, () => cronRun(j.id), () => void refresh())}
              />
              <ConsoleMiniBtn
                label={j.enabled === false ? "启用" : "禁用"}
                disabled={acting}
                onClick={() =>
                  void run(
                    "更新任务",
                    () => cronUpdate(j.id, { enabled: j.enabled === false }),
                    () => void refresh(),
                  )
                }
              />
              <ConsoleMiniBtn
                label="删除"
                variant="danger"
                disabled={acting}
                onClick={() => void run(`删除 ${j.id}`, () => cronRemove(j.id), () => void refresh())}
              />
            </ConsoleRow>
          ))
        )}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleNodesSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [nodePairs, setNodePairs] = useState(parsePairRequests([]));
  const [devicePairs, setDevicePairs] = useState(parsePairRequests([]));
  const [nodeList, setNodeList] = useState<unknown>(null);
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleNodes();
      const byMethod = Object.fromEntries(rows.map((r) => [r.method, r.ok ? r.data : null]));
      setNodePairs(parsePairRequests(byMethod["node.pair.list"]));
      setDevicePairs(parsePairRequests(byMethod["device.pair.list"]));
      setNodeList(byMethod["node.list"] ?? null);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="节点配对与设备授权审批"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="flex flex-col gap-3 overflow-auto">
        <div className="text-xs font-medium text-[var(--text-primary)]">节点配对请求</div>
        {nodePairs.length === 0 ? (
          <p className="text-[10px] text-[var(--text-tertiary)]">无待处理节点配对</p>
        ) : (
          nodePairs.map((p) => (
            <ConsoleRow key={p.id} title={p.label ?? p.id} subtitle={p.status}>
              <ConsoleMiniBtn
                label="批准"
                variant="primary"
                disabled={acting}
                onClick={() => void run("批准节点", () => nodePairApprove(p.id), () => void refresh())}
              />
              <ConsoleMiniBtn
                label="拒绝"
                variant="danger"
                disabled={acting}
                onClick={() => void run("拒绝节点", () => nodePairReject(p.id), () => void refresh())}
              />
            </ConsoleRow>
          ))
        )}
        <div className="text-xs font-medium text-[var(--text-primary)]">设备配对</div>
        {devicePairs.length === 0 ? (
          <p className="text-[10px] text-[var(--text-tertiary)]">无待处理设备配对</p>
        ) : (
          devicePairs.map((p) => (
            <ConsoleRow key={p.id} title={p.label ?? p.id} subtitle={p.status}>
              <ConsoleMiniBtn
                label="批准"
                variant="primary"
                disabled={acting}
                onClick={() => void run("批准设备", () => devicePairApprove(p.id), () => void refresh())}
              />
              <ConsoleMiniBtn
                label="拒绝"
                variant="danger"
                disabled={acting}
                onClick={() => void run("拒绝设备", () => devicePairReject(p.id), () => void refresh())}
              />
              <ConsoleMiniBtn
                label="移除"
                variant="danger"
                disabled={acting}
                onClick={() => void run("移除设备", () => devicePairRemove(p.id), () => void refresh())}
              />
            </ConsoleRow>
          ))
        )}
        {nodeList ? (
          <>
            <div className="text-xs font-medium text-[var(--text-primary)]">已连接节点</div>
            <ConsoleJsonPreview data={nodeList} />
          </>
        ) : null}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleUsageSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ lines: string[]; json: string } | null>(null);
  const [cost, setCost] = useState<string>("");

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleUsage();
      const status = rows.find((r) => r.method === "usage.status");
      const costRow = rows.find((r) => r.method === "usage.cost");
      setUsage(summarizeUsage(status?.ok ? status.data : null));
      setCost(costRow?.ok ? formatRpcResultForDisplay(costRow) : costRow?.error ?? "");
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="Token 用量与费用统计"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="flex flex-col gap-3 overflow-auto">
        {usage?.lines.map((line) => (
          <div key={line} className="text-xs text-[var(--text-secondary)]">
            {line}
          </div>
        ))}
        {cost ? (
          <>
            <div className="text-xs font-medium text-[var(--text-primary)]">费用明细</div>
            <pre className="max-h-64 overflow-auto text-[10px] text-[var(--text-secondary)]">{cost}</pre>
          </>
        ) : null}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleConfigSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<unknown>(null);
  const [patchText, setPatchText] = useState('{\n  "agents": {\n    "defaults": {}\n  }\n}');
  const [confirmApply, setConfirmApply] = useState(false);
  const [profileLabel, setProfileLabel] = useState<string | null>(null);
  const { acting, run } = useControlAction();

  useEffect(() => {
    void getCachedDistributionProfile().then((p) => {
      setProfileLabel(profileDisplayLabel(p));
    });
  }, []);

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleConfig();
      const cfg = rows.find((r) => r.method === "config.get");
      setConfig(cfg?.ok ? cfg.data : null);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const applyPatch = () => {
    let patch: Record<string, unknown>;
    try {
      patch = JSON.parse(patchText) as Record<string, unknown>;
    } catch {
      useUiStore.getState().showToast("Patch 必须是合法 JSON", "error");
      return;
    }
    void run("配置补丁", () => configPatch(patch), () => void refresh());
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="查看运行时配置；通过 config.patch 深度修改（不重启本机服务进程）"
      busy={busy}
      onRefresh={() => void refresh()}
      actions={
        <ConsoleMiniBtn
          label="应用配置"
          variant="primary"
          disabled={acting}
          onClick={() => setConfirmApply(true)}
        />
      }
    >
      <ConfirmDialog
        open={confirmApply}
        title="应用配置到本机服务？"
        titleId="console-config-apply-title"
        variant="default"
        confirmLabel="应用"
        onClose={() => setConfirmApply(false)}
        onConfirm={() => {
          setConfirmApply(false);
          void run("应用配置", () => configApply(), () => void refresh());
        }}
      >
        将调用 config.apply 使补丁生效。请确认当前连接稳定。
      </ConfirmDialog>
      {profileLabel ? (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--brand-color)_25%,var(--border-subtle))] bg-[var(--brand-tint-8)] px-3 py-2 text-[10px] text-[var(--text-secondary)]">
          分发档：<strong className="text-[var(--text-primary)]">{profileLabel}</strong>
          {profileLabel === INTERNAL_PROFILE_LABEL
            ? " — 已启用 provider 保护，禁止误改中转站或删除 deepseek 配置。"
            : null}
        </p>
      ) : null}
      <ConsoleJsonPreview data={config} />
      <div className="grid gap-2">
        <div className="text-xs font-medium text-[var(--text-primary)]">config.patch</div>
        <textarea
          className="yt-input min-h-[8rem] font-mono text-[10px]"
          value={patchText}
          onChange={(e) => setPatchText(e.target.value)}
        />
        <ConsoleMiniBtn label="提交补丁" variant="primary" disabled={acting} onClick={applyPatch} />
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleSkillsSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState(parseSkillStatus([]));
  const [installName, setInstallName] = useState("");
  const { acting, run } = useControlAction();
  const showToast = useUiStore((s) => s.showToast);

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleSkills();
      const st = rows.find((r) => r.method === "skills.status");
      setSkills(parseSkillStatus(st?.ok ? st.data : []));
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const install = async () => {
    const name = installName.trim();
    if (!name) return;
    const res = await installGatewaySkill(name);
    if (res.ok) {
      showToast(res.message ?? "已安装", "success");
      void refresh();
    } else {
      showToast(res.message ?? "安装失败", "error");
    }
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="技能安装、启用/禁用"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="flex gap-2">
        <input
          className="yt-input flex-1 text-xs"
          placeholder="技能名安装"
          value={installName}
          onChange={(e) => setInstallName(e.target.value)}
        />
        <ConsoleMiniBtn label="安装" variant="primary" disabled={acting} onClick={() => void install()} />
      </div>
      <div className="flex flex-col gap-2 overflow-auto">
        {skills.map((s) => (
          <ConsoleRow
            key={s.name}
            title={s.name}
            subtitle={s.description ?? (s.enabled === false ? "已禁用" : "已启用")}
          >
            <ConsoleMiniBtn
              label={s.enabled === false ? "启用" : "禁用"}
              disabled={acting}
              onClick={() =>
                void run(
                  "更新技能",
                  () => skillsUpdate(s.name, { enabled: s.enabled === false }),
                  () => void refresh(),
                )
              }
            />
          </ConsoleRow>
        ))}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleSessionsSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState(parseGatewaySessions([]));
  const { acting, run } = useControlAction();
  const showToast = useUiStore((s) => s.showToast);
  const requestNavToChat = useUiStore((s) => s.requestNavToChat);
  const requestNavToConsole = useUiStore((s) => s.requestNavToConsole);
  const localSessions = useSessionStore((s) => s.sessions);
  const backfillHistoryFromGateway = useSessionStore((s) => s.backfillHistoryFromGateway);

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleSessions();
      const list = rows.find((r) => r.method === "sessions.list");
      setSessions(parseGatewaySessions(list?.ok ? list.data : []));
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const openLocalChat = (remoteKey: string) => {
    const local = findLocalSessionByRemoteKey(remoteKey, localSessions);
    if (!local) {
      showToast("未找到关联的本地会话，请先在聊天中发起对话", "info");
      return;
    }
    requestNavToChat(local.id);
  };

  const syncHistory = (remoteKey: string) => {
    const local = findLocalSessionByRemoteKey(remoteKey, localSessions);
    if (!local) {
      showToast("无本地会话可同步", "info");
      return;
    }
    void backfillHistoryFromGateway(local.id, { reload: true, silent: false });
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="本机服务侧会话管理；可跳转本地聊天、同步历史或进入压缩分支"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="flex flex-col gap-2 overflow-auto">
        {sessions.map((s) => (
          <ConsoleRow
            key={s.key}
            title={s.label ?? s.key}
            subtitle={[s.agentId, s.updatedAt].filter(Boolean).join(" · ")}
          >
            <ConsoleMiniBtn label="打开聊天" disabled={acting} onClick={() => openLocalChat(s.key)} />
            <ConsoleMiniBtn
              label="同步历史"
              disabled={acting}
              onClick={() => syncHistory(s.key)}
            />
            <ConsoleMiniBtn
              label="压缩分支"
              disabled={acting}
              onClick={() => requestNavToConsole("compaction", s.key)}
            />
            <ConsoleMiniBtn
              label="重置"
              disabled={acting}
              onClick={() =>
                void run("重置会话", () => gatewaySessionReset(s.key), () => void refresh())
              }
            />
            <ConsoleMiniBtn
              label="删除"
              variant="danger"
              disabled={acting}
              onClick={() =>
                void run("删除会话", () => gatewaySessionDelete(s.key), () => void refresh())
              }
            />
          </ConsoleRow>
        ))}
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleChannelsSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<unknown>(null);
  const [channelId, setChannelId] = useState("");
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleChannels();
      setStatus(rows[0]?.ok ? rows[0].data : null);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const channels = (() => {
    const r = unwrapRecord(status);
    if (!r) return [] as string[];
    const list = r.channels ?? r.items ?? r.connected;
    if (Array.isArray(list)) {
      return list.map((c) => (typeof c === "string" ? c : String((c as Record<string, unknown>).id ?? c)));
    }
    return Object.keys(r).filter((k) => !["ok", "status"].includes(k));
  })();

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="消息渠道状态与登出"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <ConsoleJsonPreview data={status} />
      <div className="flex flex-wrap gap-2">
        {channels.map((ch) => (
          <ConsoleMiniBtn
            key={ch}
            label={`登出 ${ch}`}
            variant="danger"
            disabled={acting}
            onClick={() => void run(`登出 ${ch}`, () => channelLogout(ch), () => void refresh())}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="yt-input flex-1 text-xs"
          placeholder="渠道 ID 手动登出"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
        />
        <ConsoleMiniBtn
          label="登出"
          variant="danger"
          disabled={acting || !channelId.trim()}
          onClick={() =>
            void run("渠道登出", () => channelLogout(channelId), () => void refresh())
          }
        />
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleMemorySection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<unknown>(null);
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const rows = await fetchConsoleMemory();
      setStatus(rows[0]?.ok ? rows[0].data : null);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="Memory doctor 诊断与修复"
      busy={busy}
      onRefresh={() => void refresh()}
      actions={
        <ConsoleMiniBtn
          label="修复梦境产物"
          variant="primary"
          disabled={acting}
          onClick={() => void run("内存修复", () => memoryDoctorRepair(), () => void refresh())}
        />
      }
    >
      <ConsoleJsonPreview data={status} />
    </ConsoleSectionFrame>
  );
}

export function ConsoleAgentsSection({ connState }: SectionProps) {
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editModel, setEditModel] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      await loadAgents();
    } finally {
      setBusy(false);
    }
  }, [connState, loadAgents]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const saveEdit = () => {
    if (!editId) return;
    const client = getGatewayClient();
    void run(
      "更新 Agent",
      async () => {
        try {
          await updateAgent(
            (m, p) => client.request(m, p),
            {
              id: editId,
              agentId: editId,
              name: editName.trim() || editId,
              model: editModel.trim() || undefined,
            },
          );
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      () => {
        setEditId(null);
        void refresh();
      },
    );
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="Agent 完整管理：编辑名称/模型、删除"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <ConfirmDialog
        open={Boolean(deleteId)}
        title="删除 Agent？"
        titleId="console-agent-delete-title"
        variant="danger"
        confirmLabel="删除"
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          const id = deleteId;
          setDeleteId(null);
          if (!id) return;
          const client = getGatewayClient();
          void run(
            "删除 Agent",
            async () => {
              try {
                await deleteAgent((m, p) => client.request(m, p), id);
                return { ok: true };
              } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) };
              }
            },
            () => void refresh(),
          );
        }}
      >
        {`将从本机服务删除助手「${deleteId ?? ""}」。此操作不可恢复。`}
      </ConfirmDialog>
      <div className="flex flex-col gap-2 overflow-auto">
        {agents.map((a) => (
          <ConsoleRow
            key={a.id}
            title={a.name}
            subtitle={[a.id, a.model, a.isDefault ? "默认" : ""].filter(Boolean).join(" · ")}
          >
            <ConsoleMiniBtn
              label="编辑"
              onClick={() => {
                setEditId(a.id);
                setEditName(a.name);
                setEditModel(a.model);
              }}
            />
            {isAgentDeletable(a) ? (
              <ConsoleMiniBtn label="删除" variant="danger" onClick={() => setDeleteId(a.id)} />
            ) : null}
          </ConsoleRow>
        ))}
      </div>
      {editId ? (
        <div className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-3">
          <div className="text-xs font-medium">编辑 {editId}</div>
          <input className="yt-input text-xs" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <input className="yt-input text-xs" value={editModel} onChange={(e) => setEditModel(e.target.value)} />
          <div className="flex gap-2">
            <ConsoleMiniBtn label="保存" variant="primary" disabled={acting} onClick={saveEdit} />
            <ConsoleMiniBtn label="取消" onClick={() => setEditId(null)} />
          </div>
        </div>
      ) : null}
    </ConsoleSectionFrame>
  );
}

export function ConsoleTtsSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<unknown>(null);
  const [wake, setWake] = useState<unknown>(null);
  const [provider, setProvider] = useState("");
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const [st, wk] = await Promise.all([ttsStatus(), voiceWakeGet()]);
      setStatus(st.ok ? st.data : st.error);
      setWake(wk.ok ? wk.data : wk.error);
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="语音开关、提供商与语音唤醒（不重启本机服务）"
      busy={busy}
      onRefresh={() => void refresh()}
      actions={
        <>
          <ConsoleMiniBtn
            label="启用 TTS"
            variant="primary"
            disabled={acting}
            onClick={() => void run("启用 TTS", () => ttsEnable(), () => void refresh())}
          />
          <ConsoleMiniBtn
            label="禁用 TTS"
            disabled={acting}
            onClick={() => void run("禁用 TTS", () => ttsDisable(), () => void refresh())}
          />
        </>
      }
    >
      <ConsoleJsonPreview data={status} />
      <ConsoleJsonPreview data={wake} />
      <div className="flex gap-2">
        <input
          className="yt-input flex-1 text-xs"
          placeholder="TTS Provider ID"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        />
        <ConsoleMiniBtn
          label="设置 Provider"
          disabled={acting || !provider.trim()}
          onClick={() =>
            void run("设置 TTS Provider", () => ttsSetProvider(provider), () => void refresh())
          }
        />
      </div>
      <div className="flex gap-2">
        <ConsoleMiniBtn
          label="开启语音唤醒"
          disabled={acting}
          onClick={() => void run("语音唤醒", () => voiceWakeSet(true), () => void refresh())}
        />
        <ConsoleMiniBtn
          label="关闭语音唤醒"
          disabled={acting}
          onClick={() => void run("语音唤醒", () => voiceWakeSet(false), () => void refresh())}
        />
      </div>
    </ConsoleSectionFrame>
  );
}

export function ConsoleExecSection({ connState }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [policyText, setPolicyText] = useState("{}");
  const { acting, run } = useControlAction();

  const refresh = useCallback(async () => {
    if (connState !== "connected") return;
    setBusy(true);
    try {
      const res = await execApprovalsGet();
      if (res.ok) {
        setPolicyText(JSON.stringify(res.data, null, 2));
      }
    } finally {
      setBusy(false);
    }
  }, [connState]);

  useEffect(() => {
    if (connState === "connected") void refresh();
  }, [connState, refresh]);

  const save = () => {
    let policy: Record<string, unknown>;
    try {
      policy = JSON.parse(policyText) as Record<string, unknown>;
    } catch {
      useUiStore.getState().showToast("策略必须是合法 JSON", "error");
      return;
    }
    void run("保存审批策略", () => execApprovalsSet(policy), () => void refresh());
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="exec.approvals 策略（与聊天中 Exec 审批弹窗联动）"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <p className="text-[10px] text-[var(--text-tertiary)]">
        修改后不影响当前 WebSocket 连接；新策略对后续工具调用生效。
      </p>
      <textarea
        className="yt-input min-h-[12rem] font-mono text-[10px]"
        value={policyText}
        onChange={(e) => setPolicyText(e.target.value)}
      />
      <ConsoleMiniBtn label="保存策略" variant="primary" disabled={acting} onClick={save} />
    </ConsoleSectionFrame>
  );
}

export function ConsoleCompactionSection({ connState, focusSessionKey }: SectionProps) {
  const [busy, setBusy] = useState(false);
  const [sessionKey, setSessionKey] = useState("");
  const [branchLabel, setBranchLabel] = useState("");
  const [branches, setBranches] = useState(parseCompactionBranches([]));
  const [detail, setDetail] = useState<unknown>(null);
  const { acting, run } = useControlAction();
  const showToast = useUiStore((s) => s.showToast);
  const activeRemoteKey = useSessionStore((s) => {
    const id = s.activeId;
    const sess = id ? s.sessions.find((x) => x.id === id) : null;
    return sess?.remoteSessionKey?.trim() ?? "";
  });

  useEffect(() => {
    if (focusSessionKey?.trim()) {
      setSessionKey(focusSessionKey.trim());
    }
  }, [focusSessionKey]);

  useEffect(() => {
    if (sessionKey.trim() || !activeRemoteKey) return;
    setSessionKey(activeRemoteKey);
  }, [activeRemoteKey, sessionKey]);

  const refresh = useCallback(async () => {
    const key = sessionKey.trim();
    if (!key || connState !== "connected") return;
    setBusy(true);
    try {
      const res = await compactionList(key);
      if (res.ok) {
        setBranches(parseCompactionBranches(res.data));
      } else {
        showToast(res.error ?? "加载失败", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [connState, sessionKey, showToast]);

  const createBranch = () => {
    const key = sessionKey.trim();
    if (!key) return;
    void run(
      "创建压缩分支",
      () => compactionBranch(key, branchLabel.trim() || undefined),
      () => void refresh(),
    );
  };

  return (
    <ConsoleSectionFrame
      connState={connState}
      description="长会话压缩分支：创建分支、查看、恢复到某一快照"
      busy={busy}
      onRefresh={() => void refresh()}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className="yt-input min-w-[12rem] flex-1 text-xs"
          placeholder="sessionKey（与侧栏会话 remote key 一致）"
          value={sessionKey}
          onChange={(e) => setSessionKey(e.target.value)}
        />
        {activeRemoteKey && activeRemoteKey !== sessionKey.trim() && (
          <ConsoleMiniBtn
            label="当前聊天"
            disabled={acting}
            onClick={() => setSessionKey(activeRemoteKey)}
          />
        )}
      </div>
      <div className="flex gap-2">
        <input
          className="yt-input flex-1 text-xs"
          placeholder="新分支标签（可选）"
          value={branchLabel}
          onChange={(e) => setBranchLabel(e.target.value)}
        />
        <ConsoleMiniBtn
          label="创建分支"
          variant="primary"
          disabled={acting || !sessionKey.trim()}
          onClick={createBranch}
        />
      </div>
      <div className="flex flex-col gap-2 overflow-auto">
        {branches.map((b) => (
          <ConsoleRow
            key={b.id}
            title={b.label ?? b.id}
            subtitle={b.createdAt ?? sessionKey}
          >
            <ConsoleMiniBtn
              label="查看"
              disabled={acting}
              onClick={() => {
                void compactionGet(sessionKey.trim(), b.id).then((res) => {
                  setDetail(res.ok ? res.data : res.error);
                });
              }}
            />
            <ConsoleMiniBtn
              label="恢复"
              variant="primary"
              disabled={acting}
              onClick={() =>
                void run("恢复分支", () => compactionRestore(sessionKey.trim(), b.id), () =>
                  void refresh(),
                )
              }
            />
          </ConsoleRow>
        ))}
      </div>
      {detail ? <ConsoleJsonPreview data={detail} /> : null}
    </ConsoleSectionFrame>
  );
}
