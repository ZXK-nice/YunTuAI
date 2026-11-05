/**
 * 虚拟整体测试：模拟用户从冷启动到连接/断开/重连的完整编排路径。
 * 不依赖 Tauri 窗口与本机网关进程，用 store + 编排层契约验证稳定性。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGatewayStore } from "../../stores/gatewayStore";
import {
  connectWithFeedback,
  invalidateConnectPipeline,
  isConnectOrchestrationInFlight,
  releaseConnectPipelineUiPhase,
  setConnectPipelinePhase,
  unlockConnectPipelineForUi,
} from "../connect-with-feedback";
import { requestDesktopConnect } from "./desktop-connect-scheduler";

const connectMock = vi.fn();
const prepareMock = vi.fn();
const repairMock = vi.fn();
const recoverMock = vi.fn();
const waitReadyMock = vi.fn();
const settledMock = vi.fn();

vi.mock("../tauri-env", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("../../stores/gatewayStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stores/gatewayStore")>();
  return {
    ...actual,
    awaitGatewayConnectSettled: () => settledMock(),
  };
});

vi.mock("./gateway-connect-preflight", () => ({
  prepareGatewayForConnect: (...args: unknown[]) => prepareMock(...args),
}));

vi.mock("./repair-gateway-connection", () => ({
  repairGatewayConnection: (...args: unknown[]) => repairMock(...args),
}));

vi.mock("./auto-supervisor-recovery", () => ({
  autoRecoverSupervisorGateway: (...args: unknown[]) => recoverMock(...args),
}));

vi.mock("./gateway-ready-wait", () => ({
  waitForGatewayReady: (...args: unknown[]) => waitReadyMock(...args),
}));

const lifecycleMocks = vi.hoisted(() => ({
  lifecycleSnapConnectable: {
    establishComplete: true,
    phase: "healthy" as const,
    portReachable: true,
    processBusyLikely: false,
    externalConflict: false,
    bundledReady: true,
    wsConnectSuggested: true,
    processAlive: true,
    supervisor: {
      running: true,
      supervised: true,
      healthOk: true,
      message: "",
      pid: 1,
    },
  },
  waitForEstablishComplete: vi.fn().mockResolvedValue(true),
  fetchGatewayLifecycleSnapshot: vi.fn(),
  shouldSkipHeavyGatewayPrep: vi.fn().mockReturnValue(true),
}));

vi.mock("./gateway-lifecycle", () => ({
  waitForEstablishComplete: (...args: unknown[]) =>
    lifecycleMocks.waitForEstablishComplete(...args),
  fetchGatewayLifecycleSnapshot: (...args: unknown[]) =>
    lifecycleMocks.fetchGatewayLifecycleSnapshot(...args),
  shouldSkipHeavyGatewayPrep: (...args: unknown[]) =>
    lifecycleMocks.shouldSkipHeavyGatewayPrep(...args),
}));

vi.mock("../first-run-gateway", () => ({
  hasGatewayEverConnected: () => true,
  isFirstRunGatewayPending: () => false,
}));

vi.mock("./launch-connect-profile", () => ({
  getLaunchConnectProfile: () => ({
    freshSystemBoot: false,
    trayMode: false,
    gatewayReadyMaxMs: 8_000,
    startupConnectMaxMs: 36_000,
    postLoginGatewayWaitMs: 8_000,
    connectReadyWaitMs: 8_000,
    wakeProbeCooldownMs: 8_000,
  }),
}));

function resetGateway(overrides: Partial<ReturnType<typeof useGatewayStore.getState>> = {}) {
  useGatewayStore.setState({
    connState: "disconnected",
    startupPhase: null,
    lastError: null,
    autoReconnect: true,
    reconnectAttempt: 0,
    reconnectDueAt: null,
    reconnectTimer: null,
    reconnectDelayMs: 0,
    exclusiveReport: {
      supervisor: { running: true, supervised: true, message: "ok" },
      externalGatewayConflict: false,
      bundledReady: true,
    } as never,
    cancelReconnect: useGatewayStore.getState().cancelReconnect,
    connect: connectMock,
    disconnect: useGatewayStore.getState().disconnect,
    scheduleReconnect: useGatewayStore.getState().scheduleReconnect,
    refreshExclusiveReport: vi.fn().mockResolvedValue(undefined),
    loadGatewayPrefs: vi.fn().mockResolvedValue(undefined),
    reclaimExclusive: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

describe("虚拟整体：连接编排稳定性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    settledMock.mockResolvedValue(undefined);
    prepareMock.mockResolvedValue(undefined);
    repairMock.mockResolvedValue(true);
    recoverMock.mockResolvedValue(true);
    waitReadyMock.mockResolvedValue(true);
    lifecycleMocks.waitForEstablishComplete.mockResolvedValue(true);
    lifecycleMocks.fetchGatewayLifecycleSnapshot.mockResolvedValue(
      lifecycleMocks.lifecycleSnapConnectable,
    );
    lifecycleMocks.shouldSkipHeavyGatewayPrep.mockReturnValue(true);
    invalidateConnectPipeline();
    resetGateway();
  });

  afterEach(() => {
    invalidateConnectPipeline();
    useGatewayStore.getState().cancelReconnect();
    vi.useRealTimers();
  });

  it("场景 A：启动屏退出后 UI 解锁，管线不再回写 startupPhase", async () => {
    connectMock.mockImplementation(
      () =>
        new Promise(() => {
          /* 模拟慢连接 */
        }),
    );
    useGatewayStore.setState({
      connState: "connecting",
      startupPhase: "正在等待本机网关就绪…",
    });

    releaseConnectPipelineUiPhase();
    expect(useGatewayStore.getState().startupPhase).toBeNull();
    expect(useGatewayStore.getState().connState).toBe("connecting");

    setConnectPipelinePhase("不应再出现");
    expect(useGatewayStore.getState().startupPhase).toBeNull();
  });

  it("场景 B：requestDesktopConnect 与 connectWithFeedback 并发时只执行一次", async () => {
    let calls = 0;
    connectMock.mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      useGatewayStore.setState({ connState: "connected", startupPhase: null });
    });

    const p1 = requestDesktopConnect({ direct: true, context: "虚拟并发A", maxMs: 5_000 });
    await new Promise((r) => setTimeout(r, 5));
    const p2 = connectWithFeedback("虚拟并发B", { skipPrepare: true, fastReopen: true, maxMs: 5_000 });
    const [a, b] = await Promise.all([p1, p2]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toBe(1);
    expect(isConnectOrchestrationInFlight()).toBe(false);
  });

  it("场景 C：用户 disconnect 会作废管线，避免后台重新连上", async () => {
    connectMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      if (useGatewayStore.getState().connState !== "disconnected") {
        useGatewayStore.setState({ connState: "connected" });
      }
    });

    const pipeline = connectWithFeedback("虚拟断开", {
      skipPrepare: true,
      fastReopen: true,
      maxMs: 8_000,
    });
    await new Promise((r) => setTimeout(r, 10));
    invalidateConnectPipeline();
    useGatewayStore.getState().disconnect();

    const ok = await pipeline;
    expect(useGatewayStore.getState().connState).toBe("disconnected");
    expect(ok).toBe(false);
  });

  it("场景 D：UI 解锁后 scheduleReconnect 不再被 startupPhase 静默阻断", () => {
    vi.useFakeTimers();
    useGatewayStore.setState({
      connState: "error",
      startupPhase: null,
      autoReconnect: true,
      reconnectAttempt: 0,
      reconnectDueAt: null,
      reconnectTimer: null,
      cancelReconnect: useGatewayStore.getState().cancelReconnect,
    });
    releaseConnectPipelineUiPhase();

    useGatewayStore.getState().scheduleReconnect();

    const scheduled = useGatewayStore.getState();
    expect(scheduled.reconnectDueAt).not.toBeNull();
    expect(scheduled.reconnectDelayMs).toBeGreaterThan(0);

    vi.advanceTimersByTime(scheduled.reconnectDelayMs + 50);
    expect(connectMock).toHaveBeenCalled();
  });

  it("场景 E：连接超时后解锁 error 态，用户可再次发起连接", async () => {
    connectMock.mockImplementation(
      () =>
        new Promise(() => {
          /* hang */
        }),
    );

    const ok = await connectWithFeedback("虚拟超时", {
      skipPrepare: true,
      fastReopen: false,
      maxMs: 60,
    });

    expect(ok).toBe(false);
    const s = useGatewayStore.getState();
    expect(s.startupPhase).toBeNull();
    expect(s.connState).toBe("error");
    expect(s.lastError).toMatch(/超时|重连|本机服务/);
  });

  it("场景 F：慢网关最终连上后状态一致", async () => {
    let n = 0;
    connectMock.mockImplementation(async () => {
      n += 1;
      if (n < 2) {
        useGatewayStore.setState({ connState: "error", lastError: "瞬态失败" });
        return;
      }
      useGatewayStore.setState({ connState: "connected", startupPhase: null, lastError: null });
    });

    const ok = await connectWithFeedback("虚拟慢网关", {
      skipPrepare: true,
      fastReopen: true,
      maxMs: 8_000,
    });

    expect(ok).toBe(true);
    expect(useGatewayStore.getState().connState).toBe("connected");
    expect(useGatewayStore.getState().startupPhase).toBeNull();
  });

  it("场景 G：unlockConnectPipelineForUi 后编排未进行时可手动重连", async () => {
    useGatewayStore.setState({
      connState: "connecting",
      startupPhase: "正在连接本机服务…",
    });
    unlockConnectPipelineForUi("虚拟手动解锁");

    const s = useGatewayStore.getState();
    expect(s.startupPhase).toBeNull();
    expect(s.connState).toBe("error");
    expect(s.lastError).toBe("虚拟手动解锁");
    expect(isConnectOrchestrationInFlight()).toBe(false);
  });
});
