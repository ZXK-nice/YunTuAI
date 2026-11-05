import { getGatewayClient } from "./gateway-runtime";
import {
  computeMethodCoverage,
  extractGatewayMethodsList,
  extractGatewayVersion,
  type MethodCoverageReport,
} from "./gateway-method-coverage";

export type GatewayCapabilities = {
  supportsAgentsList: boolean;
  supportsSessionsList: boolean;
  supportsSessionsCreate: boolean;
  supportsTools: boolean;
  supportsMultiAgent: boolean;
  supportsChatHistory: boolean;
  supportsNativeChatSend: boolean;
  supportsLogs: boolean;
  agentCount: number;
  detectedAt: number | null;
  gatewayVersion: string | null;
  methodCoverage: MethodCoverageReport | null;
};

const DEFAULT_CAPABILITIES: GatewayCapabilities = {
  supportsAgentsList: false,
  supportsSessionsList: false,
  supportsSessionsCreate: false,
  supportsTools: false,
  supportsMultiAgent: false,
  supportsChatHistory: false,
  supportsNativeChatSend: false,
  supportsLogs: false,
  agentCount: 0,
  detectedAt: null,
  gatewayVersion: null,
  methodCoverage: null,
};

let cachedCapabilities: GatewayCapabilities | null = null;

function mergeCapabilities(
  existing: GatewayCapabilities,
  partial: Partial<GatewayCapabilities>,
): GatewayCapabilities {
  return { ...existing, ...partial, detectedAt: Date.now() };
}

export async function probeGatewayCapabilities(opts?: {
  skipAgentsList?: boolean;
  knownAgentCount?: number;
  force?: boolean;
}): Promise<GatewayCapabilities> {
  if (opts?.force) {
    cachedCapabilities = null;
  }
  if (cachedCapabilities) {
    return cachedCapabilities;
  }
  const client = getGatewayClient();
  if (!client.isHelloOk) {
    return cachedCapabilities ?? { ...DEFAULT_CAPABILITIES };
  }

  let caps: GatewayCapabilities = { ...DEFAULT_CAPABILITIES, detectedAt: Date.now() };

  const agentsProbe = (async (): Promise<Partial<GatewayCapabilities>> => {
    if (opts?.skipAgentsList && opts.knownAgentCount != null) {
      return {
        supportsAgentsList: true,
        agentCount: opts.knownAgentCount,
        supportsMultiAgent: opts.knownAgentCount > 1,
      };
    }
    try {
      const agentsRaw = await client.request<unknown>("agents.list", {}, { timeoutMs: 5000 });
      const agentsArr = extractAgentArray(agentsRaw);
      return {
        supportsAgentsList: true,
        agentCount: agentsArr.length,
        supportsMultiAgent: agentsArr.length > 1,
      };
    } catch (e) {
      console.error("[gateway-capabilities] agents.list probe failed:", e);
      return { supportsAgentsList: false, agentCount: 0, supportsMultiAgent: false };
    }
  })();

  const sessionsProbe = (async (): Promise<Partial<GatewayCapabilities>> => {
    try {
      await client.request<unknown>("sessions.list", {}, { timeoutMs: 5000 });
      return { supportsSessionsList: true, supportsSessionsCreate: true };
    } catch (e) {
      console.error("[gateway-capabilities] sessions.list probe failed:", e);
      return { supportsSessionsList: false, supportsSessionsCreate: false };
    }
  })();

  const identityProbe = (async (): Promise<string | null> => {
    try {
      const raw = await client.request<unknown>("gateway.identity.get", {}, { timeoutMs: 5000 });
      return extractGatewayVersion(raw);
    } catch {
      return null;
    }
  })();

  const methodsProbe = (async (): Promise<Partial<GatewayCapabilities>> => {
    try {
      const methodsRaw = await client.request<unknown>("list_methods", {}, { timeoutMs: 3000 }).catch(() => null);
      if (methodsRaw && typeof methodsRaw === "object") {
        const methodsArr = extractGatewayMethodsList(methodsRaw);
        const gatewayVersion = await identityProbe;
        const methodCoverage =
          methodsArr.length > 0 ? computeMethodCoverage(methodsArr, gatewayVersion) : null;
        return {
          supportsTools: methodsArr.some((m) => m.includes("tool")),
          supportsLogs: methodsArr.some((m) => m.includes("log")),
          supportsChatHistory: methodsArr.some((m) => m.includes("chat.history")),
          supportsNativeChatSend:
            methodsArr.includes("chat.send") && methodsArr.includes("agent.wait"),
          gatewayVersion,
          methodCoverage,
        };
      }
    } catch (e) {
      console.error("[gateway-capabilities] list_methods probe failed:", e);
      /* list_methods may not be available */
    }
    const gatewayVersion = await identityProbe;
    return gatewayVersion ? { gatewayVersion, methodCoverage: null } : {};
  })();

  const [agentsPart, sessionsPart, methodsPart] = await Promise.all([
    agentsProbe,
    sessionsProbe,
    methodsProbe,
  ]);

  caps = mergeCapabilities(caps, agentsPart);
  caps = mergeCapabilities(caps, sessionsPart);
  caps = mergeCapabilities(caps, methodsPart);

  cachedCapabilities = caps;
  return caps;
}

export function clearCapabilitiesCache(): void {
  cachedCapabilities = null;
}

function extractAgentArray(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const list = r.agents ?? r.list;
  if (Array.isArray(list)) return list;
  if (Array.isArray(raw)) return raw;
  return [];
}

