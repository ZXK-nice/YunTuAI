import { afterEach, describe, expect, it, vi } from "vitest";
import * as tauriEnv from "../tauri-env";
import * as cliBridge from "./cli-bridge";
import {
  __resetRemediateStateForTest,
  __wrapRemediationResultForTest,
  healthUrlFromGatewayWsUrl,
  runAbnormalCloseStrategy,
  runConnectFailureStrategy,
} from "./gateway-recovery";

describe("healthUrlFromGatewayWsUrl", () => {
  it("converts ws to http and strips query", () => {
    expect(healthUrlFromGatewayWsUrl("ws://127.0.0.1:18789?token=abc")).toBe(
      "http://127.0.0.1:18789",
    );
    expect(healthUrlFromGatewayWsUrl("wss://example.com/gw")).toBe("https://example.com/gw");
  });

  it("returns null for blank", () => {
    expect(healthUrlFromGatewayWsUrl("   ")).toBeNull();
  });
});

describe("runConnectFailureStrategy", () => {
  it("classifies handshake timeout without auto-remediate", async () => {
    __resetRemediateStateForTest();
    const r = await runConnectFailureStrategy({
      error: new Error("握手超时（请确认本机服务已启动且端口正确）"),
      autoRemediate: false,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 0,
    });
    expect(r.followUp).toBe("reconnect");
    expect(r.displayError).toMatch(/本机|端口|Token/i);
    expect(r.toasts.length).toBeGreaterThan(0);
  });

  it("does not auto-remediate generic policy failures", async () => {
    __resetRemediateStateForTest();
    const r = await runConnectFailureStrategy({
      error: new Error("服务拒绝握手 (1008): invalid connect params"),
      autoRemediate: true,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 1,
    });
    expect(r.displayError).not.toMatch(/【检测】/);
    expect(r.followUp).toBe("reconnect");
  });

  it("surfaces token_mismatch as actionable hint", async () => {
    __resetRemediateStateForTest();
    const r = await runConnectFailureStrategy({
      error: new Error('{"code":"AUTH_TOKEN_MISMATCH","message":"token_mismatch"}'),
      autoRemediate: false,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 0,
    });
    expect(r.displayError).toMatch(/Token|token|环境变量/i);
    expect(r.followUp).toBe("reconnect");
  });

  it("handles rate_limited with short reconnect after supervisor restart", async () => {
    __resetRemediateStateForTest();
    vi.spyOn(tauriEnv, "isTauriRuntime").mockReturnValue(true);
    const r = await runConnectFailureStrategy({
      error: new Error(
        "服务拒绝握手 (1008): unauthorized: too many failed authentication attempts (retry later)",
      ),
      autoRemediate: true,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 1,
    });
    vi.restoreAllMocks();
    expect(r.followUp).toBe("reconnect_soon");
    expect(r.reconnectDelayMs).toBeLessThanOrEqual(5_000);
    expect(r.displayError).toMatch(/认证|限流|重启/i);
  });

  it("suppresses scary banner for handshake timeout during startup grace", async () => {
    __resetRemediateStateForTest();
    const r = await runConnectFailureStrategy({
      error: new Error("握手超时（请确认本机服务已启动且端口正确）"),
      autoRemediate: true,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 0,
    });
    expect(r.followUp).toBe("reconnect_soon");
    expect(r.displayError).toBe("正在自动重连本机服务…");
    expect(r.toasts).toHaveLength(0);
  });
});

describe("__wrapRemediationResultForTest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps ok when health JSON looks healthy", async () => {
    vi.spyOn(cliBridge, "cliGatewayHealthJson").mockResolvedValue({
      ok: true,
      stdout: '{"ok":true,"status":"running"}',
      stderr: "",
      exitCode: 0,
    });
    const wrapped = await __wrapRemediationResultForTest("restart", {
      ok: true,
      stdout: "restarted",
      stderr: "",
      exitCode: 0,
    });
    expect(wrapped.result?.ok).toBe(true);
  });

  it("rejects CLI ok when health stdout is empty", async () => {
    vi.spyOn(cliBridge, "cliGatewayHealthJson").mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    const empty = await __wrapRemediationResultForTest("start", {
      ok: true,
      stdout: "started",
      stderr: "",
      exitCode: 0,
    });
    expect(empty.result?.ok).toBe(false);
    expect(empty.result?.stderr).toMatch(/health probe failed after start/);
  });

  it("rejects CLI ok when health JSON reports unavailable", async () => {
    vi.spyOn(cliBridge, "cliGatewayHealthJson").mockResolvedValue({
      ok: true,
      stdout: '{"ok":false,"error":"unavailable"}',
      stderr: "",
      exitCode: 0,
    });
    const unhealthy = await __wrapRemediationResultForTest("restart", {
      ok: true,
      stdout: "restarted",
      stderr: "",
      exitCode: 0,
    });
    expect(unhealthy.result?.ok).toBe(false);
  });

  it("does not probe when remediation already failed", async () => {
    const spy = vi.spyOn(cliBridge, "cliGatewayHealthJson");
    const wrapped = await __wrapRemediationResultForTest("restart", {
      ok: false,
      stdout: "",
      stderr: "spawn failed",
      exitCode: 1,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(wrapped.result?.ok).toBe(false);
  });
});

describe("runAbnormalCloseStrategy", () => {
  it("suppresses 1006 banner during early reconnect attempts", async () => {
    __resetRemediateStateForTest();
    vi.spyOn(tauriEnv, "isTauriRuntime").mockReturnValue(true);
    const r = await runAbnormalCloseStrategy({
      code: 1006,
      reason: "",
      autoRemediate: true,
      wsUrl: "ws://127.0.0.1:18789",
      reconnectAttempt: 0,
    });
    vi.restoreAllMocks();
    expect(r.followUp).toBe("reconnect_soon");
    expect(r.displayError).toBe("正在自动重连本机服务…");
    expect(r.incident).toBeNull();
    expect(r.toasts).toHaveLength(0);
  });
});
