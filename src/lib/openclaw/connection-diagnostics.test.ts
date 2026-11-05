import { describe, expect, it } from "vitest";
import { buildConnectionDiagnosticsSummary } from "./connection-diagnostics";
import type { GatewayLifecycleSnapshot } from "./gateway-lifecycle";

function sampleLifecycle(): GatewayLifecycleSnapshot {
  return {
    phase: "healthy",
    detail: "port ok",
    at: new Date().toISOString(),
    establishComplete: true,
    processAlive: true,
    portReachable: true,
    processBusyLikely: false,
    wsConnectSuggested: true,
    externalConflict: false,
    bundledReady: true,
    supervisor: {
      supervised: true,
      pid: 99,
      running: true,
      healthOk: true,
      message: "",
    },
  };
}

describe("buildConnectionDiagnosticsSummary", () => {
  it("includes connection and session fields", () => {
    const text = buildConnectionDiagnosticsSummary({
      connState: "connected",
      wsUrl: "ws://127.0.0.1:18789",
      lastError: null,
      serverInfo: "ok",
      healthLatencyMs: 42,
      reconnectAttempt: 0,
      connectionQuality: "good",
      capabilities: {
        supportsAgentsList: true,
        supportsSessionsList: true,
        supportsSessionsCreate: true,
        supportsTools: true,
        supportsMultiAgent: false,
        supportsChatHistory: true,
        supportsNativeChatSend: false,
        supportsLogs: true,
        agentCount: 1,
        detectedAt: Date.now(),
        gatewayVersion: "2026.4.14",
        methodCoverage: null,
      },
      methodCoverage: {
        availableCount: 100,
        integratedCount: 50,
        integratedPresentCount: 48,
        coveragePercent: 96,
        missingIntegrated: ["wizard.start"],
        gatewayVersion: "2026.4.14",
      },
      activeSession: {
        id: "s1",
        title: "测试",
        remoteSessionKey: "agent:main:main",
        messageCount: 3,
        subscriptionHealth: "ok",
        syncingHistory: false,
      },
      distributionProfile: "internal",
    });

    expect(text).toContain("YunTu Control 本机服务连接诊断");
    expect(text).toContain("ws://127.0.0.1:18789");
    expect(text).toContain("agent:main:main");
    expect(text).toContain("RPC 集成覆盖");
    expect(text).toContain("internal");
  });

  it("includes rust service diagnostic section", () => {
    const text = buildConnectionDiagnosticsSummary({
      connState: "disconnected",
      wsUrl: "ws://127.0.0.1:18789",
      lastError: "timeout",
      serverInfo: null,
      healthLatencyMs: null,
      reconnectAttempt: 2,
      connectionQuality: "poor",
      capabilities: null,
      methodCoverage: null,
      activeSession: null,
      distributionProfile: null,
      serviceDiagnostic: {
        lifecycle: sampleLifecycle(),
        dataDir: "C:\\Users\\test\\YunTuAI",
        listenPort: 18789,
        provisionNeeded: false,
        runtimeAvailable: true,
      },
    });
    expect(text).toContain("本机服务监管（Rust 单一真相源）");
    expect(text).toContain("phase=healthy");
    expect(text).toContain("C:\\Users\\test\\YunTuAI");
    expect(text).toContain("18789");
  });
});
