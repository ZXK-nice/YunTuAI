import { describe, expect, it, vi } from "vitest";
import {
  handleGatewaySessionsChanged,
  parseSessionsChangedKeys,
  resetSessionsChangedDebounceForTests,
} from "./sessions-changed-sync";

describe("sessions-changed-sync", () => {
  it("parses keys from payload shapes", () => {
    expect(parseSessionsChangedKeys({ key: "a" })).toEqual(["a"]);
    expect(parseSessionsChangedKeys({ sessions: [{ sessionKey: "b" }, "c"] })).toEqual(["b", "c"]);
    expect(parseSessionsChangedKeys({ data: { keys: ["d"] } })).toEqual(["d"]);
  });

  it("resubscribes all when payload has no keys", async () => {
    resetSessionsChangedDebounceForTests();
    const resubscribeAll = vi.fn().mockResolvedValue(undefined);
    handleGatewaySessionsChanged({}, { resubscribeAll, subscribeKey: vi.fn(), getActiveSession: () => null, backfillActive: vi.fn() });
    await new Promise((r) => setTimeout(r, 220));
    expect(resubscribeAll).toHaveBeenCalledWith({ background: true });
  });

  it("subscribes changed keys and backfills active session", async () => {
    resetSessionsChangedDebounceForTests();
    const subscribeKey = vi.fn().mockResolvedValue(undefined);
    const backfillActive = vi.fn().mockResolvedValue(1);
    handleGatewaySessionsChanged(
      { key: "active-key" },
      {
        resubscribeAll: vi.fn(),
        subscribeKey,
        getActiveSession: () => ({ id: "sess-1", remoteSessionKey: "active-key" }),
        backfillActive,
      },
    );
    await new Promise((r) => setTimeout(r, 220));
    expect(subscribeKey).toHaveBeenCalledWith("active-key");
    expect(backfillActive).toHaveBeenCalledWith("sess-1");
  });
});
