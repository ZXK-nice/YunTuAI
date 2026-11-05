import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGatewayStore } from "../../stores/gatewayStore";

const lifecycleMocks = vi.hoisted(() => ({
  ensureGatewayServiceReady: vi.fn(async () => true),
  waitForEstablishComplete: vi.fn(async () => true),
  fetchGatewayLifecycleSnapshot: vi.fn(async () => null),
  waitReadyMock: vi.fn(async () => true),
  requestDesktopConnectMock: vi.fn(async () => true),
}));

vi.mock("./gateway-lifecycle", () => ({
  ensureGatewayServiceReady: lifecycleMocks.ensureGatewayServiceReady,
  waitForEstablishComplete: lifecycleMocks.waitForEstablishComplete,
  fetchGatewayLifecycleSnapshot: lifecycleMocks.fetchGatewayLifecycleSnapshot,
  lifecycleLooksConnectable: (snap: { portReachable?: boolean } | null) =>
    Boolean(snap?.portReachable),
}));

vi.mock("./gateway-ready-wait", () => ({
  waitForGatewayReady: lifecycleMocks.waitReadyMock,
}));

vi.mock("./connection-resilience", () => ({
  isSupervisorGatewayOperational: (st: { running?: boolean } | null) => Boolean(st?.running),
}));

vi.mock("./desktop-connect-scheduler", () => ({
  requestDesktopConnect: lifecycleMocks.requestDesktopConnectMock,
}));

const {
  prepareGatewayForConnectGate,
  prepareConnectGateThenDesktopConnect,
  __resetConnectGatePrepForTest,
} = await import("./connect-gate-prep");

const profile = {
  freshSystemBoot: false,
  trayMode: false,
  gatewayReadyMaxMs: 8_000,
  startupConnectMaxMs: 60_000,
  postLoginGatewayWaitMs: 18_000,
  connectReadyWaitMs: 8_000,
  wakeProbeCooldownMs: 8_000,
};

describe("connect-gate-prep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConnectGatePrepForTest();
    lifecycleMocks.fetchGatewayLifecycleSnapshot.mockResolvedValue(null);
    useGatewayStore.setState({
      exclusiveReport: {
        supervisor: { running: true, supervised: true, message: "ok" },
        externalGatewayConflict: false,
        bundledReady: true,
      },
      refreshExclusiveReport: vi.fn(async () => undefined),
    } as never);
  });

  it("warm start uses short establish wait", async () => {
    const result = await prepareGatewayForConnectGate(profile);
    expect(result.fastReopen).toBe(true);
    expect(lifecycleMocks.waitForEstablishComplete).toHaveBeenCalledWith({ maxMs: 4_000 });
    expect(lifecycleMocks.ensureGatewayServiceReady).not.toHaveBeenCalled();
  });

  it("cold start waits full budget and ensures service", async () => {
    useGatewayStore.setState({
      exclusiveReport: {
        supervisor: { running: false, supervised: false, message: "down" },
        externalGatewayConflict: false,
        bundledReady: true,
      },
    } as never);

    const result = await prepareGatewayForConnectGate(profile);
    expect(result.fastReopen).toBe(false);
    expect(lifecycleMocks.waitForEstablishComplete).toHaveBeenCalledWith({
      maxMs: profile.postLoginGatewayWaitMs,
    });
    expect(lifecycleMocks.ensureGatewayServiceReady).toHaveBeenCalled();
  });

  it("cold start aborts early when lifecycle reports gateway startup failure", async () => {
    lifecycleMocks.fetchGatewayLifecycleSnapshot.mockResolvedValue({
      phase: "failed",
      detail: "模型 API Key 未配置或无效，网关无法启动。",
      establishComplete: true,
      supervisor: {
        running: false,
        supervised: false,
        message: "模型 API Key 未配置或无效，网关无法启动。",
      },
    } as never);

    const ok = await prepareConnectGateThenDesktopConnect(profile, { context: "连接本机服务" });
    expect(ok).toBe(false);
    expect(useGatewayStore.getState().connState).toBe("error");
    expect(useGatewayStore.getState().lastError).toMatch(/API Key|密钥/);
    expect(lifecycleMocks.requestDesktopConnectMock).not.toHaveBeenCalled();
  });

  it("prepareConnectGateThenDesktopConnect skips duplicate establish wait", async () => {
    await prepareConnectGateThenDesktopConnect(profile, { context: "连接本机服务" });
    expect(lifecycleMocks.requestDesktopConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        skipEstablishWait: true,
        fastReopen: true,
        maxMs: 28_000,
      }),
    );
  });

  it("dedupes concurrent prepareConnectGateThenDesktopConnect", async () => {
    const p1 = prepareConnectGateThenDesktopConnect(profile, { context: "a" });
    const p2 = prepareConnectGateThenDesktopConnect(profile, { context: "b" });
    await Promise.all([p1, p2]);
    expect(lifecycleMocks.requestDesktopConnectMock).toHaveBeenCalledTimes(1);
  });

  it("marks connecting before waiting for cold-start establish", async () => {
    let resolveWait: (ok: boolean) => void = () => undefined;
    const waitGate = new Promise<boolean>((resolve) => {
      resolveWait = resolve;
    });
    lifecycleMocks.waitForEstablishComplete.mockImplementation(() => waitGate);
    useGatewayStore.setState({
      connState: "disconnected",
      exclusiveReport: {
        supervisor: { running: false, supervised: false, message: "down" },
        externalGatewayConflict: false,
        bundledReady: true,
      },
    } as never);

    const pending = prepareConnectGateThenDesktopConnect(profile, { context: "连接本机服务" });
    expect(useGatewayStore.getState().connState).toBe("connecting");
    expect(lifecycleMocks.requestDesktopConnectMock).not.toHaveBeenCalled();
    resolveWait(true);
    await pending;
    expect(lifecycleMocks.requestDesktopConnectMock).toHaveBeenCalled();
  });
});
