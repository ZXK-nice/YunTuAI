import { describe, expect, it, vi } from "vitest";
import { waitForAbortSignal } from "./send-wait";

describe("waitForAbortSignal", () => {
  it("resolves aborted when signal already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(waitForAbortSignal(ac.signal, 500)).resolves.toBe("aborted");
  });

  it("resolves aborted when signal fires before timeout", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = waitForAbortSignal(ac.signal, 1000);
    ac.abort();
    await expect(p).resolves.toBe("aborted");
    vi.useRealTimers();
  });

  it("resolves timeout when signal never fires", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const p = waitForAbortSignal(ac.signal, 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe("timeout");
    vi.useRealTimers();
  });
});
