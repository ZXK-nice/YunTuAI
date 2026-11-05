import { describe, expect, it } from "vitest";
import {
  pickCanonicalRemoteKey,
  resolveSubscriptionHealth,
  shouldPersistCanonicalKey,
} from "./session-subscription-orchestration";

describe("session-subscription-orchestration", () => {
  it("resolves subscription health", () => {
    expect(resolveSubscriptionHealth(false)).toBe("local_only");
    expect(resolveSubscriptionHealth(true, { canonicalKey: "k", eventsSubscribed: false })).toBe(
      "push_weak",
    );
    expect(resolveSubscriptionHealth(true, { canonicalKey: "k", eventsSubscribed: true })).toBe(
      "push_ok",
    );
  });

  it("picks canonical remote key", () => {
    expect(
      pickCanonicalRemoteKey("asked", { canonicalKey: "canonical", eventsSubscribed: true }),
    ).toBe("canonical");
    expect(pickCanonicalRemoteKey("asked", { canonicalKey: "", eventsSubscribed: false })).toBe(
      "asked",
    );
  });

  it("detects canonical key persistence", () => {
    expect(shouldPersistCanonicalKey("a", "b")).toBe(true);
    expect(shouldPersistCanonicalKey("a", "a")).toBe(false);
    expect(shouldPersistCanonicalKey("a", "")).toBe(false);
  });
});
