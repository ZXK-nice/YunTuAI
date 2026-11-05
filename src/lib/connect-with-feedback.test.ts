import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGatewayStore } from "../stores/gatewayStore";
import {
  connectWithFeedback,
  ensureBackgroundConnecting,
  releaseConnectPipelineUiPhase,
  resetConnectPipelineUiSuppression,
  setConnectPipelinePhase,
  unlockConnectPipelineForUi,
} from "./connect-with-feedback";

const connectMock = vi.fn();
const prepareMock = vi.fn();
const repairMock = vi.fn();
const recoverMock = vi.fn();
const waitReadyMock = vi.fn();
const settledMock = vi.fn();

vi.mock("../stores/gatewayStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stores/gatewayStore")>();
  return {
    ...actual,
    awaitGatewayConnectSettled: () => settledMock(),
  };
});

vi.mock("./tauri-env", () => ({
  isTauriRuntime: () => true,
}));

vi.mock("./openclaw/gateway-connect-preflight", () => ({
  prepareGatewayForConnect: (...args: unknown[]) => prepareMock(...args),
}));

vi.mock("./openclaw/repair-gateway-connection", () => ({
  repairGatewayConnection: (...args: unknown[]) => repairMock(...args),
}));

vi.mock("./openclaw/auto-supervisor-recovery", () => ({
  autoRecoverSupervisorGateway: (...args: unknown[]) => recoverMock(...args),
}));

vi.mock("./openclaw/gateway-ready-wait", () => ({
  waitForGatewayReady: (...args: unknown[]) => waitReadyMock(...args),
}));

vi.mock("./first-run-gateway", () => ({
  hasGatewayEverConnected: () => true,
}));

function resetGateway(overrides: Partial<ReturnType<typeof useGatewayStore.getState>> = {}) {
  useGatewayStore.setState({
    connState: "disconnected",
    startupPhase: null,
    lastError: null,
    exclusiveReport: null,
    cancelReconnect: vi.fn(),
    connect: connectMock,
    refreshExclusiveReport: vi.fn().mockResolvedValue(undefined),
    loadGatewayPrefs: vi.fn().mockResolvedValue(undefined),
    reclaimExclusive: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

describe("ensureBackgroundConnecting", () => {
  beforeEach(() => {
    resetGateway();
  });

  it("flips idle disconnected to connecting", () => {
    useGatewayStore.setState({ connState: "disconnected", lastError: "stale" });
    ensureBackgroundConnecting();
    const s = useGatewayStore.getState();
    expect(s.connState).toBe("connecting");
    expect(s.lastError).toBe("stale");
  });

  it("does not clobber an already connected session", () => {
    useGatewayStore.setState({ connState: "connected", lastError: null });
    ensureBackgroundConnecting();
    expect(useGatewayStore.getState().connState).toBe("connected");
  });
});

describe("releaseConnectPipelineUiPhase", () => {
  beforeEach(() => {
    resetGateway();
  });

  it("clears startupPhase without changing connState", () => {
    useGatewayStore.setState({
      connState: "connecting",
      startupPhase: "正在等待本机网关就绪…",
    });
    releaseConnectPipelineUiPhase();
    const s = useGatewayStore.getState();
    expect(s.startupPhase).toBeNull();
    expect(s.connState).toBe("connecting");
  });

  it("prevents setConnectPipelinePhase from re-locking UI", () => {
    releaseConnectPipelineUiPhase();
    setConnectPipelinePhase("不应出现");
    const s = useGatewayStore.getState();
    expect(s.startupPhase).toBeNull();
    expect(s.connState).toBe("connecting");
  });
});

describe("unlockConnectPipelineForUi", () => {
  beforeEach(() => {
    resetGateway();
  });

  it("clears startupPhase when already connected", () => {
    useGatewayStore.setState({ connState: "connected", startupPhase: "正在连接…" });
    unlockConnectPipelineForUi();
    expect(useGatewayStore.getState().startupPhase).toBeNull();
    expect(useGatewayStore.getState().connState).toBe("connected");
  });

  it("unlocks connecting state to error with hint", () => {
    useGatewayStore.setState({
      connState: "connecting",
      startupPhase: "正在连接本机服务…",
      lastError: null,
    });
    unlockConnectPipelineForUi("连接超时");
    const s = useGatewayStore.getState();
    expect(s.startupPhase).toBeNull();
    expect(s.connState).toBe("error");
    expect(s.lastError).toBe("连接超时");
  });

  it("preserves existing lastError when no hint", () => {
    useGatewayStore.setState({
      connState: "connecting",
      startupPhase: "x",
      lastError: "已有错误",
    });
    unlockConnectPipelineForUi();
    expect(useGatewayStore.getState().lastError).toBe("已有错误");
  });
});

describe("connectWithFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConnectPipelineUiSuppression();
    settledMock.mockResolvedValue(undefined);
    prepareMock.mockResolvedValue(undefined);
    repairMock.mockResolvedValue(true);
    recoverMock.mockResolvedValue(true);
    waitReadyMock.mockResolvedValue(true);
    connectMock.mockImplementation(async () => {
      useGatewayStore.setState({ connState: "connected", startupPhase: null });
    });
    resetGateway();
  });

  it("succeeds on first connect and clears startupPhase", async () => {
    const ok = await connectWithFeedback("手动重连");
    expect(ok).toBe(true);
    expect(connectMock).toHaveBeenCalled();
    expect(useGatewayStore.getState().connState).toBe("connected");
    expect(useGatewayStore.getState().startupPhase).toBeNull();
  });

  it("initiates connect from idle disconnected instead of aborting", async () => {
    resetGateway({ connState: "disconnected" });
    const ok = await connectWithFeedback("日常进主界面", { skipPrepare: true, fastReopen: true });
    expect(ok).toBe(true);
    expect(connectMock).toHaveBeenCalled();
    expect(useGatewayStore.getState().connState).toBe("connected");
  });

  it("does not rewrite startupPhase after main UI released the pipeline chrome", async () => {
    releaseConnectPipelineUiPhase();
    const ok = await connectWithFeedback("后台连接");
    expect(ok).toBe(true);
    expect(useGatewayStore.getState().startupPhase).toBeNull();
    expect(useGatewayStore.getState().connState).toBe("connected");
  });

  it("uses fast reopen path with skipPrepare and ensure only", async () => {
    connectMock
      .mockImplementationOnce(async () => {
        useGatewayStore.setState({ connState: "error", lastError: "fail" });
      })
      .mockImplementationOnce(async () => {
        useGatewayStore.setState({ connState: "connected", startupPhase: null });
      });

    const ok = await connectWithFeedback("重新打开快速连接", {
      skipPrepare: true,
      fastReopen: true,
    });

    expect(ok).toBe(true);
    expect(prepareMock).not.toHaveBeenCalled();
    expect(recoverMock).toHaveBeenCalled();
    expect(waitReadyMock).not.toHaveBeenCalled();
  });

  it("dedupes concurrent connectWithFeedback calls", async () => {
    let calls = 0;
    connectMock.mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      useGatewayStore.setState({ connState: "connected", startupPhase: null });
    });

    const p1 = connectWithFeedback("a", { skipPrepare: true, fastReopen: true });
    await new Promise((r) => setTimeout(r, 5));
    const p2 = connectWithFeedback("b", { skipPrepare: true, fastReopen: true });
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it(
    "times out and surfaces error state",
    async () => {
      connectMock.mockImplementation(
        () =>
          new Promise(() => {
            /* hang */
          }),
      );
      useGatewayStore.setState({
        exclusiveReport: {
          supervisor: { running: true, supervised: true, message: "ok" },
          externalGatewayConflict: false,
          bundledReady: true,
        },
      } as never);

      const ok = await connectWithFeedback("x", {
        skipPrepare: true,
        fastReopen: false,
        maxMs: 80,
      });

      expect(ok).toBe(false);
      expect(useGatewayStore.getState().connState).toBe("error");
      expect(useGatewayStore.getState().startupPhase).toBeNull();
    },
    10_000,
  );
});
