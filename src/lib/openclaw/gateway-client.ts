import { buildConnectRequest } from "./connect";
import { newRequestId } from "./ids";
import type { GatewayMessage, GatewayRes } from "./types";
import { isGatewayMessage } from "./types";

export type GatewayClientHandlers = {
  onEvent?: (event: string, payload: unknown) => void;
  onRaw?: (msg: GatewayMessage) => void;
  /** 握手成功后非用户主动断开（网络、网关重启等） */
  onUnexpectedClose?: (info: { code: number; reason: string }) => void;
};

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  connGen: number;
};

const HANDSHAKE_MS = 10_000;
/** 未显式指定 timeoutMs 时的默认 RPC 超时（sessions.send 等长任务会单独覆盖）。 */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export class GatewayWsClient {
  private ws: WebSocket | null = null;
  private readonly pending = new Map<string, Pending>();
  private handlers: GatewayClientHandlers = {};
  private helloOk = false;
  /** `disconnect()` 触发的关闭，不当作意外断线 */
  private userInitiatedClose = false;
  /** keepalive 超时触发的关闭，避免 close 事件二次触发 onUnexpectedClose */
  private keepaliveTriggeredClose = false;
  /** 当前连接是否已调用过 onUnexpectedClose，防止 WS error→close 事件链双重触发 */
  private unexpectedCloseReported = false;
  /** 递增世代号，忽略旧连接迟到的 RPC 响应。 */
  private connGen = 0;
  /** 连接重试时用的 token（挑战时重建 connect 帧） */
  private connectToken: string | undefined;
  /** keepalive 定时器，防代理/VPN/路由器空闲超时 */
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  /** keepalive 间隔 ~15s，略短以在路由器/代理超时（常见 30-60s）前发心跳 */
  private static readonly KEEPALIVE_MS = 15_000;
  /** 若连续 5 个 keepalive 周期（5×15s=75s）内 notify 均失败且未收到服务端响应，
   *  则判定静默断连。75s 仍为超长 shell/工具调用留足缓冲，
   *  同时比原 150s 更快发现真正的网络断开。 */
  private static readonly KEEPALIVE_STALE_THRESHOLD = 5;
  private lastHeardAt = 0;

  get isHelloOk(): boolean {
    return this.helloOk;
  }

  setHandlers(h: GatewayClientHandlers) {
    this.handlers = h;
  }

  connect(wsUrl: string, token?: string): Promise<void> {
    this.disconnect();
    this.helloOk = false;
    this.userInitiatedClose = false;
    this.unexpectedCloseReported = false;
    this.connGen += 1;
    const activeGen = this.connGen;
    this.connectToken = token;

    const connectFrameText = JSON.stringify(buildConnectRequest({ token }));

    return new Promise((resolve, reject) => {
      let done = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (err?: Error) => {
        if (done || activeGen !== this.connGen) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (err && activeGen === this.connGen && this.ws === ws) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          this.ws = null;
        }
        if (err) reject(err);
        else resolve();
      };

      timer = setTimeout(() => {
        if (!this.helloOk) finish(new Error("握手超时（请确认本机服务已启动且端口正确）"));
      }, HANDSHAKE_MS);

      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.addEventListener("error", () => {
        if (!this.helloOk && activeGen === this.connGen) {
          finish(new Error("无法连接到本地服务（WebSocket）"));
        }
        // After handshake, mark that we've reported the unexpected close.
        // The subsequent close event will carry the real code/reason and should
        // NOT fire onUnexpectedClose again — preventing double-reconnect.
        if (this.helloOk && activeGen === this.connGen && !this.unexpectedCloseReported) {
          this.unexpectedCloseReported = true;
          this.handlers.onUnexpectedClose?.({ code: 0, reason: "WebSocket error event (post-handshake)" });
        }
      });

      ws.addEventListener("open", () => {
        if (activeGen !== this.connGen) return;
        try {
          ws.send(connectFrameText);
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });

      ws.addEventListener("message", (ev) => {
        if (activeGen !== this.connGen) return;
        try {
          const raw = String(ev.data);
          const parsed: unknown = JSON.parse(raw);
          if (!isGatewayMessage(parsed)) return;
          // 收到任何服务端帧即刷新心跳时间戳
          this.lastHeardAt = Date.now();
          this.handlers.onRaw?.(parsed);

          if (parsed.type === "res") {
            this.handleRes(parsed, activeGen, finish);
            return;
          }

          if (parsed.type === "event") {
            // OpenClaw 2026.5+ 在回环 + dangerouslyDisableDeviceAuth 下重发 connect（新 ID）即可跳过设备签名
            if (parsed.event === "connect.challenge") {
              if (ws.readyState === WebSocket.OPEN) {
                try {
                  ws.send(JSON.stringify(buildConnectRequest({ token: this.connectToken })));
                } catch { /* best effort */ }
              }
              return;
            }
            this.handlers.onEvent?.(parsed.event, parsed.payload);
          }
        } catch (e) {
          if (!this.helloOk) finish(e instanceof Error ? e : new Error(String(e)));
        }
      });

      ws.addEventListener("close", (ev: Event) => {
        if (activeGen !== this.connGen) return;
        this.ws = null;
        this.stopKeepalive();
        const wasHello = this.helloOk;
        this.helloOk = false;
        const intentional = this.userInitiatedClose;
        this.userInitiatedClose = false;
        for (const [, p] of this.pending) {
          if (p.connGen === activeGen) p.reject(new Error("连接已关闭"));
        }
        for (const [id, p] of this.pending) {
          if (p.connGen === activeGen) this.pending.delete(id);
        }
        if (wasHello && !intentional && !this.keepaliveTriggeredClose && !this.unexpectedCloseReported) {
          const ce = ev as CloseEvent;
          const code = typeof ce.code === "number" ? ce.code : 0;
          const reason = typeof ce.reason === "string" ? ce.reason.trim() : "";
          this.handlers.onUnexpectedClose?.({ code, reason });
        }
        this.keepaliveTriggeredClose = false;
        this.unexpectedCloseReported = false;
        if (!done && !wasHello) {
          const ce = ev as CloseEvent;
          const code = typeof ce.code === "number" ? ce.code : 0;
          const reason = typeof ce.reason === "string" && ce.reason.trim() ? ce.reason.trim() : "";
          let msg = "连接在握手完成前关闭";
          if (code === 1008 && reason) {
            msg = `服务拒绝握手 (${code}): ${reason}`;
          } else if (reason) {
            msg = `${msg} (${code}): ${reason}`;
          } else if (code !== 1000 && code !== 1005) {
            msg = `${msg} (WebSocket code=${code})`;
          }
          finish(new Error(msg));
        }
      });
    });
  }

  private handleRes(
    msg: GatewayRes,
    activeGen: number,
    finishHandshake: (err?: Error) => void,
  ) {
    if (activeGen !== this.connGen) return;
    const id = msg.id;
    const pend = this.pending.get(id);
    if (pend) {
      if (pend.connGen !== activeGen) return;
      this.pending.delete(id);
      if (msg.ok) pend.resolve(msg.payload);
      else pend.reject(new Error(JSON.stringify(msg.error ?? "RPC 失败")));
      return;
    }

    if (msg.ok && msg.payload && typeof msg.payload === "object" && "type" in msg.payload) {
      const t = (msg.payload as { type?: string }).type;
      if (t === "hello-ok") {
        this.helloOk = true;
        finishHandshake();
        this.startKeepalive();
        return;
      }
    }

    if (!this.helloOk && msg.ok === false) {
      finishHandshake(new Error(JSON.stringify(msg.error ?? "握手失败")));
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastHeardAt = Date.now();
    this.keepaliveTimer = setInterval(() => {
      // 每周期发送一次轻量心跳，防止 NAT/代理/VPN 空闲超时静默断连。
      // notify 成功（ws.send 未抛异常）说明 TCP 链路仍存活 → 刷新 lastHeardAt；
      // 若 TCP 已断，send 本身会失败，lastHeardAt 持续老化直至触发静默判定。
      const sent = this.notify("health");
      if (sent) {
        this.lastHeardAt = Date.now();
      }
      const staleMs = Date.now() - this.lastHeardAt;
      const staleThreshold =
        GatewayWsClient.KEEPALIVE_MS * GatewayWsClient.KEEPALIVE_STALE_THRESHOLD;
      // 连续 KEEPALIVE_STALE_THRESHOLD 个周期 notify 均失败且无服务端帧 → 静默死亡
      if (staleMs > staleThreshold) {
        this.stopKeepalive();
        this.keepaliveTriggeredClose = true;
        const ev = { code: 1006, reason: "keepalive 静默超时（无服务端响应）" };
        this.handlers.onUnexpectedClose?.(ev);
        try {
          this.ws?.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
      }
    }, GatewayWsClient.KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.lastHeardAt = 0;
  }

  disconnect() {
    this.stopKeepalive();
    this.lastHeardAt = 0;
    this.userInitiatedClose = true;
    this.unexpectedCloseReported = false;
    this.connGen += 1;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    } else {
      this.helloOk = false;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("已断开"));
    }
    this.pending.clear();
  }

  notify(method: string, params: Record<string, unknown> = {}): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.helloOk) {
      return false;
    }
    try {
      ws.send(
        JSON.stringify({
          type: "req",
          id: newRequestId(),
          method,
          params,
        } satisfies GatewayMessage),
      );
      return true;
    } catch {
      return false;
    }
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    opts?: { timeoutMs?: number; id?: string },
  ): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("服务未连接"));
    }
    if (!this.helloOk) {
      return Promise.reject(new Error("服务握手未完成"));
    }

    const id = opts?.id?.trim() || newRequestId();
    const reqGen = this.connGen;
    const body = JSON.stringify({
      type: "req",
      id,
      method,
      params,
    } satisfies GatewayMessage);

    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const clearTo = () => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };
      const wrapResolve = (v: unknown) => {
        clearTo();
        resolve(v as T);
      };
      const wrapReject = (e: Error) => {
        clearTo();
        reject(e);
      };

      this.pending.set(id, {
        resolve: wrapResolve,
        reject: wrapReject,
        connGen: reqGen,
      });

      const ms = opts?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
      if (ms > 0) {
        timeoutId = setTimeout(() => {
          const p = this.pending.get(id);
          if (p?.connGen === reqGen && this.pending.delete(id)) {
            wrapReject(new Error(`请求超时（${ms}ms）：${method}`));
          }
        }, ms);
      }

      try {
        ws.send(body);
      } catch (e) {
        this.pending.delete(id);
        clearTo();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * 高级控制台：解析 JSON 文本并发送 `req`。
   * 支持 `{ "method", "params" }` 或完整 `{ "type":"req", "id"?, "method", "params"? }`。
   */
  flexibleRequest(jsonText: string, opts?: { timeoutMs?: number }): Promise<unknown> {
    let obj: unknown;
    try {
      obj = JSON.parse(jsonText);
    } catch {
      return Promise.reject(new Error("JSON 解析失败"));
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return Promise.reject(new Error("根节点须为 JSON 对象"));
    }
    const rec = obj as Record<string, unknown>;
    if ("type" in rec && rec.type !== undefined && rec.type !== "req") {
      return Promise.reject(new Error('仅支持发送服务请求：type 须为 "req" 或省略'));
    }
    if (rec.type === "req") {
      if (typeof rec.method !== "string" || !rec.method.trim()) {
        return Promise.reject(new Error('type:req 须包含非空字符串 method'));
      }
      let params: Record<string, unknown> = {};
      if (rec.params !== undefined) {
        if (typeof rec.params !== "object" || rec.params === null || Array.isArray(rec.params)) {
          return Promise.reject(new Error("params 须为对象"));
        }
        params = rec.params as Record<string, unknown>;
      }
      const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
      return this.request(rec.method.trim(), params, { ...opts, id });
    }
    if (typeof rec.method === "string" && rec.method.trim()) {
      let params: Record<string, unknown> = {};
      if (rec.params !== undefined) {
        if (typeof rec.params !== "object" || rec.params === null || Array.isArray(rec.params)) {
          return Promise.reject(new Error("params 须为对象"));
        }
        params = rec.params as Record<string, unknown>;
      }
      return this.request(rec.method.trim(), params, opts);
    }
    return Promise.reject(new Error('缺少 method，或使用 { "type":"req", "method", "params" }'));
  }
}