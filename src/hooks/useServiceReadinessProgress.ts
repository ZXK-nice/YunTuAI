import { useEffect, useRef, useState } from "react";
import {
  ensureGatewayLifecycleListener,
  useGatewayLifecycleStore,
  type GatewayLifecycleSnapshot,
} from "../lib/openclaw/gateway-lifecycle";
import {
  fetchProvisionStatus,
  listenProvisionProgress,
  type ProvisionSnapshot,
} from "../lib/openclaw/provision-bridge";
import { isTauriRuntime } from "../lib/tauri-env";
import type { GatewayConnState } from "../stores/gateway-store-types";
import { useGatewayStore } from "../stores/gatewayStore";
import {
  sanitizeReadinessDetail,
  userLifecyclePhaseLabel,
  userProvisionPhaseLabel,
} from "../lib/product/readiness-copy";

export type ServiceReadinessProgress = {
  lifecycle: GatewayLifecycleSnapshot | null;
  provision: ProvisionSnapshot | null;
  /** 0–100 综合进度（与 Rust provision / lifecycle / 连接管线对齐） */
  combinedPercent: number;
  phaseLabel: string;
  detail: string;
};

export type ConnectProgressHints = {
  connState: GatewayConnState;
  startupPhase: string | null;
};

const PROVISION_PHASE_LABEL: Record<string, string> = {
  prepare: userProvisionPhaseLabel("prepare"),
  download: userProvisionPhaseLabel("download"),
  extract: userProvisionPhaseLabel("extract"),
  npm: userProvisionPhaseLabel("npm"),
  finalize: userProvisionPhaseLabel("finalize"),
  configure: userProvisionPhaseLabel("configure"),
  control: userProvisionPhaseLabel("control"),
  verify: userProvisionPhaseLabel("verify"),
  skills: userProvisionPhaseLabel("skills"),
  done: userProvisionPhaseLabel("done", 100),
};

/** 连接管线各阶段与 connect-with-feedback 文案对齐 */
const STARTUP_PHASE_PERCENT: Array<{ match: RegExp; percent: number }> = [
  { match: /回收.*控制权/, percent: 24 },
  { match: /恢复本机服务/, percent: 52 },
  { match: /等待.*就绪/, percent: 70 },
  { match: /恢复连接/, percent: 78 },
  { match: /连接本机服务/, percent: 48 },
  { match: /连接/, percent: 45 },
];

function matchStartupPhasePercent(phase: string | null): number | null {
  if (!phase?.trim()) return null;
  const trimmed = phase.trim();
  for (const { match, percent } of STARTUP_PHASE_PERCENT) {
    if (match.test(trimmed)) return percent;
  }
  return null;
}

/** 根据 lifecycle 快照细粒度推算（避免未知阶段卡在 40%）。 */
export function computeLifecyclePercent(snap: GatewayLifecycleSnapshot | null): number {
  if (!snap) return 8;
  switch (snap.phase) {
    case "healthy":
      return 100;
    case "degraded":
      if (snap.processBusyLikely || (snap.portReachable && snap.wsConnectSuggested)) {
        return 88;
      }
      return 93;
    case "failed":
      return 0;
    case "preparing": {
      let p = 22;
      if (snap.bundledReady) p += 10;
      if (snap.establishComplete) p += 18;
      return Math.min(p, snap.establishComplete ? 48 : 38);
    }
    case "starting": {
      let p = 32;
      if (snap.establishComplete) p += 10;
      if (snap.processAlive) p += 12;
      if (snap.portReachable) p += 16;
      if (snap.supervisor.running) p += 8;
      if (snap.wsConnectSuggested) p += 12;
      return Math.min(p, 96);
    }
    default:
      return 10;
  }
}

function computeConnectPercent(hints: ConnectProgressHints): number {
  if (hints.connState === "connected") return 100;
  const phasePct = matchStartupPhasePercent(hints.startupPhase);
  if (hints.connState === "connecting") {
    return phasePct ?? 42;
  }
  if (hints.connState === "error") return 0;
  return phasePct ?? 12;
}

function lifecyclePhaseLabel(phase: GatewayLifecycleSnapshot["phase"] | undefined): string {
  return userLifecyclePhaseLabel(phase ?? "preparing");
}

export function computeServiceReadinessProgress(
  lifecycle: GatewayLifecycleSnapshot | null,
  provision: ProvisionSnapshot | null,
  hints?: ConnectProgressHints,
): ServiceReadinessProgress {
  const provActive = Boolean(
    provision && (provision.running || provision.needed || !provision.ready),
  );

  let combinedPercent: number;
  if (provActive && provision) {
    // Rust openclaw_provision 已按阶段推送真实 percent，直接采用
    combinedPercent = provision.running || provision.percent > 0
      ? provision.percent
      : Math.max(provision.percent, computeLifecyclePercent(lifecycle));
  } else {
    const lifePct = computeLifecyclePercent(lifecycle);
    const connPct = hints ? computeConnectPercent(hints) : null;
    // establish 未完成时勿用连接管线 70% 盖过「准备环境」进度
    if (lifecycle && !lifecycle.establishComplete) {
      combinedPercent = lifePct;
    } else {
      combinedPercent = connPct != null ? Math.max(lifePct, connPct) : lifePct;
    }
  }

  const phaseLabel =
    provActive && provision && (provision.running || provision.percent < 100)
      ? PROVISION_PHASE_LABEL[provision.phase] ?? provision.phase
      : lifecyclePhaseLabel(lifecycle?.phase);

  const detail = sanitizeReadinessDetail(
    (provActive && provision?.message?.trim()) ||
      hints?.startupPhase?.trim() ||
      lifecycle?.detail ||
      "正在准备办公环境，请稍候…",
  );

  return {
    lifecycle,
    provision,
    combinedPercent: Math.min(100, Math.max(0, combinedPercent)),
    phaseLabel,
    detail,
  };
}

/** 首启/连接屏：合并 provision 事件、lifecycle 推送与连接管线阶段（无 IPC 轮询）。 */
export function useServiceReadinessProgress(enabled: boolean): ServiceReadinessProgress {
  const lifecycle = useGatewayLifecycleStore((s) => s.snapshot);
  const connState = useGatewayStore((s) => s.connState);
  const startupPhase = useGatewayStore((s) => s.startupPhase);
  const [provision, setProvision] = useState<ProvisionSnapshot | null>(null);
  const monotonicRef = useRef(0);
  const [displayPercent, setDisplayPercent] = useState(0);

  useEffect(() => {
    if (!enabled) {
      monotonicRef.current = 0;
      setDisplayPercent(0);
      return;
    }
    if (!isTauriRuntime()) return;

    ensureGatewayLifecycleListener();
    let cancelled = false;

    void fetchProvisionStatus().then((s) => {
      if (!cancelled && s) setProvision(s);
    });

    const unlistenProv = listenProvisionProgress((snap) => {
      if (!cancelled) setProvision(snap);
    });

    return () => {
      cancelled = true;
      void unlistenProv.then((fn) => fn());
    };
  }, [enabled]);

  const computed = computeServiceReadinessProgress(lifecycle, provision, {
    connState,
    startupPhase,
  });

  useEffect(() => {
    if (!enabled) return;
    const next = Math.max(monotonicRef.current, computed.combinedPercent);
    if (computed.combinedPercent <= 3 && monotonicRef.current >= 90) {
      monotonicRef.current = computed.combinedPercent;
    } else {
      monotonicRef.current = next;
    }
    setDisplayPercent(monotonicRef.current);
  }, [enabled, computed.combinedPercent]);

  return { ...computed, combinedPercent: displayPercent };
}
