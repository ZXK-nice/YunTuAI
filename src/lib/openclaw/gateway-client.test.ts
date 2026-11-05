import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GatewayWsClient } from "./gateway-client";

describe("GatewayWsClient handshake timeout", () => {
  const OriginalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("closes socket and rejects when hello-ok never arrives", async () => {
    const close = vi.fn();
    class HangWs {
      static OPEN = 1;
      readyState = HangWs.OPEN;
      close = close;
      addEventListener() {
        /* never open / never hello */
      }
    }
    globalThis.WebSocket = HangWs as unknown as typeof WebSocket;

    const client = new GatewayWsClient();
    const pending = client.connect("ws://127.0.0.1:18789");
    const rejection = expect(pending).rejects.toThrow(/握手超时/);
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
    expect(close).toHaveBeenCalled();
  });
});
