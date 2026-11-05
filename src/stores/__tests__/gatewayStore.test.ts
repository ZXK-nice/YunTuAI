import { describe, expect, it, beforeEach } from "vitest";
import { useGatewayStore } from "../gatewayStore";
import { useAuthStore } from "../authStore";

function resetGatewayStore() {
  useGatewayStore.setState({
    wsUrl: "ws://127.0.0.1:18789",
    token: "test-token",
    connState: "disconnected",
    lastError: null,
    serverInfo: null,
    reconnectAttempt: 0,
    reconnectDelayMs: 0,
    reconnectDueAt: null,
    autoReconnect: true,
    autoRemediateOpenClaw: true,
    stallWatchdogEnabled: true,
    startupPhase: null,
    gatewayCapabilities: null,
    gatewayLastIncident: null,
    exclusiveReport: null,
    exclusiveLoading: false,
    reconnectTimer: null,
    healthLatencyMs: null,
    connectionQuality: "unknown",
  });
}

describe("gatewayStore", () => {
  beforeEach(() => {
    useAuthStore.setState({ isLoggedIn: true });
    resetGatewayStore();
  });

  describe("initial state", () => {
    it("starts disconnected", () => {
      expect(useGatewayStore.getState().connState).toBe("disconnected");
    });

    it("has default reconnect config", () => {
      const s = useGatewayStore.getState();
      expect(s.autoReconnect).toBe(true);
      expect(s.autoRemediateOpenClaw).toBe(true);
      expect(s.stallWatchdogEnabled).toBe(true);
      expect(s.reconnectAttempt).toBe(0);
    });

    it("has null lastError", () => {
      expect(useGatewayStore.getState().lastError).toBeNull();
    });
  });

  describe("connState transitions", () => {
    it("can be set to connecting", () => {
      useGatewayStore.setState({ connState: "connecting" });
      expect(useGatewayStore.getState().connState).toBe("connecting");
    });

    it("can be set to connected", () => {
      useGatewayStore.setState({
        connState: "connected",
        serverInfo: "OpenClaw v1.0",
      });
      expect(useGatewayStore.getState().connState).toBe("connected");
      expect(useGatewayStore.getState().serverInfo).toBe("OpenClaw v1.0");
    });

    it("can be set to error", () => {
      useGatewayStore.setState({
        connState: "error",
        lastError: "Connection refused",
      });
      expect(useGatewayStore.getState().connState).toBe("error");
      expect(useGatewayStore.getState().lastError).toBe("Connection refused");
    });
  });

  describe("connection lifecycle", () => {
    it("has connect function", () => {
      expect(typeof useGatewayStore.getState().connect).toBe("function");
    });

    it("has disconnect function", () => {
      expect(typeof useGatewayStore.getState().disconnect).toBe("function");
    });

    it("has scheduleReconnect / cancelReconnect functions", () => {
      expect(typeof useGatewayStore.getState().scheduleReconnect).toBe("function");
      expect(typeof useGatewayStore.getState().cancelReconnect).toBe("function");
    });
  });

  describe("capabilities", () => {
    it("gatewayCapabilities defaults to null", () => {
      expect(useGatewayStore.getState().gatewayCapabilities).toBeNull();
    });

    it("has probeCapabilities function", () => {
      expect(typeof useGatewayStore.getState().probeCapabilities).toBe("function");
    });
  });

  describe("autoRemediateOpenClaw", () => {
    it("is enabled by default", () => {
      expect(useGatewayStore.getState().autoRemediateOpenClaw).toBe(true);
    });

    it("can be toggled off", () => {
      useGatewayStore.setState({ autoRemediateOpenClaw: false });
      expect(useGatewayStore.getState().autoRemediateOpenClaw).toBe(false);
    });
  });
});
