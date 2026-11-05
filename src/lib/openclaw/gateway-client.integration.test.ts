import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayWsClient } from "./gateway-client";

/**
 * OpenClaw 连接状态机集成测试。
 *
 * 目的：在不改动任何运行时逻辑的前提下，用一个可编程的 WebSocket 桩驱动
 * `GatewayWsClient` 的完整生命周期（握手 / RPC / 心跳 / 断线 / 世代号），
 * 锁定当前行为，为将来的连接改动提供回归护栏。
 */

type Listener = (ev: unknown) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  /** 记录所有 send 出去的原始文本帧 */
  sent: string[] = [];
  /** 置真后 send() 抛错，用于模拟 TCP 链路断裂 */
  sendShouldThrow = false;
  closeCalls = 0;

  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];
  static reset() {
    MockWebSocket.instances = [];
  }
  static last(): MockWebSocket {
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    if (!ws) throw new Error("尚未创建 WebSocket 实例");
    return ws;
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }
  send(data: string) {
    if (this.sendShouldThrow) throw new Error("send failed (simulated TCP drop)");
    this.sent.push(data);
  }
  close() {
    this.closeCalls += 1;
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close", { code: 1000, reason: "" });
  }

  // ---- 测试驱动辅助 ----
  private dispatch(type: string, ev: unknown) {
    for (const cb of this.listeners[type] || []) cb(ev);
  }
  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.dispatch("open", {});
  }
  emitMessage(obj: unknown) {
    this.dispatch("message", { data: JSON.stringify(obj) });
  }
  emitClose(code = 1006, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    this.dispatch("close", { code, reason });
  }
  emitError() {
    this.dispatch("error", {});
  }

  /** 已发送帧中最后一个 method === value 的帧计数 */
  countSentMethod(method: string): number {
    return this.sent.filter((raw) => {
      try {
        return (JSON.parse(raw) as { method?: string }).method === method;
      } catch {
        return false;
      }
    }).length;
  }
  hasSentConnect(): boolean {
    return this.sent.some((raw) => {
      try {
        const p = JSON.parse(raw) as { method?: string; type?: string };
        return p.method === "connect";
      } catch {
        return false;
      }
    });
  }
}

const HELLO_OK = { type: "res", id: "srv-hello", ok: true, payload: { type: "hello-ok" } };

async function establishConnected(client: GatewayWsClient) {
  const pending = client.connect("ws://127.0.0.1:18789", "tkn");
  const ws = MockWebSocket.last();
  ws.emitOpen();
  ws.emitMessage(HELLO_OK);
  await pending;
  return ws;
}

describe("GatewayWsClient 连接状态机（集成）", () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("open 后发送 connect 帧，收到 hello-ok 即完成握手", async () => {
    const client = new GatewayWsClient();
    const ws = await establishConnected(client);
    expect(client.isHelloOk).toBe(true);
    expect(ws.hasSentConnect()).toBe(true);
  });

  it("收到 connect.challenge 时重发 connect 帧（回环免签名路径）", async () => {
    const client = new GatewayWsClient();
    const ws = await establishConnected(client);
    const before = ws.countSentMethod("connect");
    ws.emitMessage({ type: "event", event: "connect.challenge", payload: {} });
    expect(ws.countSentMethod("connect")).toBe(before + 1);
  });

  it("RPC 请求在收到匹配 res 时 resolve，在 ok=false 时 reject", async () => {
    const client = new GatewayWsClient();
    const ws = await establishConnected(client);

    const okReq = client.request("health", {}, { id: "req-ok" });
    ws.emitMessage({ type: "res", id: "req-ok", ok: true, payload: { ok: true } });
    await expect(okReq).resolves.toEqual({ ok: true });

    const errReq = client.request("boom", {}, { id: "req-err" });
    ws.emitMessage({ type: "res", id: "req-err", ok: false, error: "nope" });
    await expect(errReq).rejects.toThrow(/nope/);
  });

  it("握手后网关意外断开会回调 onUnexpectedClose，并带上 code/reason", async () => {
    const client = new GatewayWsClient();
    const onUnexpectedClose = vi.fn();
    client.setHandlers({ onUnexpectedClose });
    const ws = await establishConnected(client);

    ws.emitClose(1006, "网关重启");
    expect(onUnexpectedClose).toHaveBeenCalledTimes(1);
    expect(onUnexpectedClose).toHaveBeenCalledWith({ code: 1006, reason: "网关重启" });
  });

  it("用户主动 disconnect 不触发 onUnexpectedClose，并 reject 挂起请求", async () => {
    const client = new GatewayWsClient();
    const onUnexpectedClose = vi.fn();
    client.setHandlers({ onUnexpectedClose });
    const ws = await establishConnected(client);

    const pendingReq = client.request("slow", {}, { id: "req-slow", timeoutMs: 0 });
    // 挂起请求应被 reject，避免悬空 Promise
    const assertion = expect(pendingReq).rejects.toThrow(/已断开|连接已关闭/);
    client.disconnect();
    await assertion;
    expect(onUnexpectedClose).not.toHaveBeenCalled();
    expect(ws.closeCalls).toBeGreaterThan(0);
  });

  it("连接关闭会 reject 该连接下所有挂起 RPC", async () => {
    const client = new GatewayWsClient();
    client.setHandlers({ onUnexpectedClose: () => {} });
    const ws = await establishConnected(client);

    const pendingReq = client.request("slow", {}, { id: "req-close", timeoutMs: 0 });
    const assertion = expect(pendingReq).rejects.toThrow(/连接已关闭/);
    ws.emitClose(1006, "");
    await assertion;
  });

  it("未连接时 request 立即 reject", async () => {
    const client = new GatewayWsClient();
    await expect(client.request("health")).rejects.toThrow(/未连接/);
  });

  it("keepalive：send 持续失败且无服务端帧时，超过静默阈值触发 1006 断线回调", async () => {
    const client = new GatewayWsClient();
    const onUnexpectedClose = vi.fn();
    client.setHandlers({ onUnexpectedClose });
    const ws = await establishConnected(client);

    // 模拟 TCP 链路断裂：此后每次 keepalive 的 notify(send) 都会失败，
    // lastHeardAt 不再刷新，staleMs 持续增长直至越过 75s 阈值。
    ws.sendShouldThrow = true;
    await vi.advanceTimersByTimeAsync(90_000);

    expect(onUnexpectedClose).toHaveBeenCalledTimes(1);
    const arg = onUnexpectedClose.mock.calls[0]?.[0] as { code: number };
    expect(arg.code).toBe(1006);
  });

  it("keepalive：链路正常（send 成功）时不会误判断线", async () => {
    const client = new GatewayWsClient();
    const onUnexpectedClose = vi.fn();
    client.setHandlers({ onUnexpectedClose });
    await establishConnected(client);

    // send 一直成功 → lastHeardAt 每周期刷新 → 不应触发断线
    await vi.advanceTimersByTimeAsync(120_000);
    expect(onUnexpectedClose).not.toHaveBeenCalled();
  });

  it("世代号：重新 connect 后，旧连接迟到的 res 不会误 resolve 新请求", async () => {
    const client = new GatewayWsClient();
    client.setHandlers({ onUnexpectedClose: () => {} });
    const ws1 = await establishConnected(client);

    // 旧连接下发一个请求（将在重连时被 reject）
    const staleReq = client.request("stale", {}, { id: "dup-id", timeoutMs: 0 });
    const staleAssertion = expect(staleReq).rejects.toThrow(/已断开|连接已关闭/);

    // 重新连接（connGen 递增，旧 ws 被关闭）
    const pending2 = client.connect("ws://127.0.0.1:18789", "tkn");
    await staleAssertion;
    const ws2 = MockWebSocket.last();
    ws2.emitOpen();
    ws2.emitMessage(HELLO_OK);
    await pending2;

    // 旧连接迟到的同 id res 不应影响新连接
    ws1.emitMessage({ type: "res", id: "dup-id", ok: true, payload: { leaked: true } });
    expect(client.isHelloOk).toBe(true);
  });
});
