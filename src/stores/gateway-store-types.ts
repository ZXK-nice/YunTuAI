import type { GatewayCapabilities } from "../lib/openclaw/gateway-capabilities";
import type { GatewayIncident } from "../lib/openclaw/gateway-recovery";
import type { OpenClawExclusiveReport } from "../lib/openclaw/cli-bridge";
import type { ConnectionQuality } from "../lib/connection-quality";

export type GatewayConnState = "disconnected" | "connecting" | "connected" | "error";

export type GatewayStore = {
  wsUrl: string;
  token: string;
  connState: GatewayConnState;
  lastError: string | null;
  serverInfo: string | null;
  reconnectAttempt: number;
  reconnectDelayMs: number;
  reconnectDueAt: number | null;
  autoReconnect: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  healthLatencyMs: number | null;
  connectionQuality: ConnectionQuality;
  startupPhase: string | null;

  setWsUrl: (v: string) => void;
  setToken: (v: string) => void;
  setAutoReconnect: (v: boolean) => void;
  loadGatewayPrefs: () => Promise<void>;
  autoRemediateOpenClaw: boolean;
  setAutoRemediateOpenClaw: (v: boolean) => void;
  gatewayLastIncident: GatewayIncident | null;
  exclusiveReport: OpenClawExclusiveReport | null;
  exclusiveLoading: boolean;
  gatewayCapabilities: GatewayCapabilities | null;
  stallWatchdogEnabled: boolean;
  setStallWatchdogEnabled: (v: boolean) => void;
  refreshExclusiveReport: () => Promise<void>;
  applyExclusiveReport: (report: OpenClawExclusiveReport) => void;
  reclaimExclusive: () => Promise<boolean>;
  probeCapabilities: () => Promise<void>;
  connect: (opts?: { skipPrepare?: boolean }) => Promise<void>;
  disconnect: () => void;
  scheduleReconnect: () => void;
  cancelReconnect: () => void;
};
