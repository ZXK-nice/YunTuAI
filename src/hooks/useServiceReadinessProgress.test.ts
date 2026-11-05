import { describe, expect, it } from "vitest";
import {
  computeLifecyclePercent,
  computeServiceReadinessProgress,
} from "./useServiceReadinessProgress";
import type { GatewayLifecycleSnapshot } from "../lib/openclaw/gateway-lifecycle";

function lifecycle(partial: Partial<GatewayLifecycleSnapshot>): GatewayLifecycleSnapshot {
  return {
    phase: "starting",
    detail: "启动中",
    at: new Date().toISOString(),
    establishComplete: true,
    processAlive: false,
    portReachable: false,
    processBusyLikely: false,
    wsConnectSuggested: false,
    externalConflict: false,
    bundledReady: true,
    supervisor: {
      supervised: false,
      pid: null,
      running: false,
      healthOk: false,
      message: "",
    },
    ...partial,
  };
}

describe("computeLifecyclePercent", () => {
  it("does not default to 40% when lifecycle unknown", () => {
    expect(computeLifecyclePercent(null)).toBe(8);
  });

  it("increases with port and ws hints during starting", () => {
    const base = computeLifecyclePercent(lifecycle({ phase: "starting" }));
    const advanced = computeLifecyclePercent(
      lifecycle({
        phase: "starting",
        processAlive: true,
        portReachable: true,
        wsConnectSuggested: true,
        supervisor: { supervised: true, pid: 1, running: true, healthOk: true, message: "" },
      }),
    );
    expect(advanced).toBeGreaterThan(base);
    expect(advanced).toBeGreaterThan(60);
  });
});

describe("computeServiceReadinessProgress", () => {
  it("uses provision percent directly when install running", () => {
    const r = computeServiceReadinessProgress(lifecycle({ phase: "starting" }), {
      percent: 65,
      phase: "npm",
      message: "安装组件",
      running: true,
      needed: true,
      ready: false,
      error: null,
      choiceRequired: false,
      globalAvailable: true,
      bundledReady: true,
      bundledInstallAvailable: true,
      bundledVersion: "1.0.0",
      runtimeSource: "bundled",
    });
    expect(r.combinedPercent).toBe(65);
    expect(r.detail).toContain("安装组件");
  });

  it("maps connect pipeline startupPhase to progress", () => {
    const r = computeServiceReadinessProgress(
      lifecycle({ phase: "starting", portReachable: true, processAlive: true }),
      null,
      { connState: "connecting", startupPhase: "正在等待本机服务就绪…" },
    );
    expect(r.combinedPercent).toBeGreaterThanOrEqual(70);
  });

  it("uses lifecycle only when provision idle", () => {
    const r = computeServiceReadinessProgress(lifecycle({ phase: "healthy", detail: "就绪" }), null);
    expect(r.combinedPercent).toBe(100);
    expect(r.phaseLabel).toBe("准备完成");
  });
});
