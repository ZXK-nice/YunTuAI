import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeAuthed = vi.fn();
const cliGatewaySupervisorEnsure = vi.fn();
const autoRecoverSupervisorGateway = vi.fn();

vi.mock("../tauri-env", () => ({ isTauriRuntime: () => true }));
vi.mock("../tauri-invoke", () => ({ invokeAuthed: (...args: unknown[]) => invokeAuthed(...args) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("./cli-bridge", () => ({
  cliGatewaySupervisorEnsure: (...args: unknown[]) => cliGatewaySupervisorEnsure(...args),
}));
vi.mock("./auto-supervisor-recovery", () => ({
  autoRecoverSupervisorGateway: (...args: unknown[]) => autoRecoverSupervisorGateway(...args),
}));

import { ensureGatewayServiceReady } from "./gateway-lifecycle";

function lifecycleSnap(connectable: boolean) {
  return {
    phase: connectable ? ("healthy" as const) : ("starting" as const),
    detail: connectable ? "ok" : "waiting",
    at: new Date().toISOString(),
    establishComplete: true,
    processAlive: connectable,
    portReachable: connectable,
    processBusyLikely: false,
    wsConnectSuggested: connectable,
    externalConflict: false,
    bundledReady: true,
    supervisor: {
      supervised: connectable,
      pid: connectable ? 42 : null,
      running: connectable,
      healthOk: connectable,
      message: "",
    },
  };
}

describe("ensureGatewayServiceReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cliGatewaySupervisorEnsure.mockResolvedValue(undefined);
    autoRecoverSupervisorGateway.mockResolvedValue(true);
  });

  it("skips supervisor ensure while establish is incomplete", async () => {
    invokeAuthed.mockImplementation(async (cmd: string) => {
      if (cmd === "gateway_lifecycle_snapshot") {
        return { ...lifecycleSnap(false), establishComplete: false };
      }
      return null;
    });
    await expect(ensureGatewayServiceReady({ maxWaitMs: 80 })).resolves.toBe(false);
    expect(autoRecoverSupervisorGateway).not.toHaveBeenCalled();
    expect(cliGatewaySupervisorEnsure).not.toHaveBeenCalled();
  });

  it("returns true when lifecycle snapshot is already connectable", async () => {
    invokeAuthed.mockImplementation(async (cmd: string) => {
      if (cmd === "gateway_lifecycle_snapshot") return lifecycleSnap(true);
      return null;
    });
    await expect(ensureGatewayServiceReady()).resolves.toBe(true);
    expect(invokeAuthed).toHaveBeenCalledWith("gateway_lifecycle_snapshot", {});
    expect(autoRecoverSupervisorGateway).not.toHaveBeenCalled();
  });

  it("skips supervisor recovery when port is up and process is busy-likely", async () => {
    invokeAuthed.mockImplementation(async (cmd: string) => {
      if (cmd === "gateway_lifecycle_snapshot") {
        return {
          ...lifecycleSnap(false),
          phase: "degraded" as const,
          processBusyLikely: true,
          portReachable: true,
          wsConnectSuggested: true,
          supervisor: {
            supervised: true,
            pid: 42,
            running: true,
            healthOk: false,
            message: "",
          },
        };
      }
      return null;
    });
    await expect(ensureGatewayServiceReady({ maxWaitMs: 80 })).resolves.toBe(true);
    expect(autoRecoverSupervisorGateway).not.toHaveBeenCalled();
    expect(cliGatewaySupervisorEnsure).not.toHaveBeenCalled();
  });

  it("runs recovery path when not connectable then succeeds", async () => {
    invokeAuthed.mockImplementation(async (cmd: string) => {
      if (cmd === "gateway_lifecycle_snapshot") return lifecycleSnap(false);
      return null;
    });
    autoRecoverSupervisorGateway.mockResolvedValue(true);
    await expect(ensureGatewayServiceReady({ maxWaitMs: 80 })).resolves.toBe(true);
    expect(autoRecoverSupervisorGateway).toHaveBeenCalled();
  });
});
