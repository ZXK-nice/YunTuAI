import { describe, expect, it } from "vitest";
import type { GatewayWsClient } from "./gateway-client";
import {
  gatewayRowToPreviewMessage,
  gatewayRowsToLocalPreview,
  syncSessionMessagesFromGateway,
} from "./session-gateway-sync";
import type { GatewayHistoryRow } from "./session-history-backfill";

describe("session-gateway-sync", () => {
  it("maps gateway rows to preview messages", () => {
    const row: GatewayHistoryRow = {
      role: "user",
      content: "hello",
      gatewayId: "g1",
      createdAt: "1000",
    };
    expect(gatewayRowToPreviewMessage(row, "sess-1", 0)).toEqual({
      id: "gw:g1",
      sessionId: "sess-1",
      role: "user",
      content: "hello",
      createdAt: "1000",
    });
    expect(gatewayRowsToLocalPreview("sess-1", [row])).toHaveLength(1);
  });

  it("returns local page when gateway disconnected", async () => {
    const local = {
      messages: [{ id: "1", sessionId: "s", role: "user", content: "x", createdAt: "1" }],
      hasMore: false,
    };
    const result = await syncSessionMessagesFromGateway({
      sessionId: "s",
      remoteSessionKey: "rk",
      connConnected: false,
      invokeListMessages: async () => local,
      request: (async () => null) as GatewayWsClient["request"],
    });
    expect(result.page).toEqual(local);
    expect(result.gatewayFetched).toBe(0);
  });

  it("shows gateway preview when local empty and backfill cannot persist", async () => {
    let listCalls = 0;
    const result = await syncSessionMessagesFromGateway({
      sessionId: "s",
      remoteSessionKey: "rk",
      connConnected: true,
      invokeListMessages: async () => {
        listCalls += 1;
        return { messages: [], hasMore: false };
      },
      request: (async (method) => {
        if (method === "chat.history") {
          return { messages: [{ role: "assistant", text: "hi" }] };
        }
        return null;
      }) as GatewayWsClient["request"],
    });
    expect(listCalls).toBe(1);
    expect(result.gatewayFetched).toBeGreaterThan(0);
    expect(result.page.messages).toHaveLength(1);
    expect(result.page.messages[0]?.content).toBe("hi");
  });
});
