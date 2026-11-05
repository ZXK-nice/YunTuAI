import { describe, expect, it } from "vitest";
import {
  claimMessageFingerprint,
  clearMessageFingerprintClaims,
  hasRecentSessionMessageFingerprint,
  releaseMessageFingerprint,
  shouldSkipDuplicateSessionMessage,
} from "./chat-message-dedup";
import type { LocalMessageRow } from "../../stores/sessionStore";

const row = (role: string, content: string): LocalMessageRow => ({
  id: "1",
  sessionId: "s",
  role,
  content,
  createdAt: "1",
});

describe("chat-message-dedup", () => {
  it("detects duplicate in recent tail", () => {
    const msgs = [row("assistant", "hello"), row("user", "q")];
    expect(hasRecentSessionMessageFingerprint(msgs, "assistant", "hello")).toBe(true);
    expect(hasRecentSessionMessageFingerprint(msgs, "assistant", "other")).toBe(false);
  });

  it("blocks parallel claims for same fingerprint", () => {
    clearMessageFingerprintClaims();
    expect(claimMessageFingerprint("s1", "assistant", "same")).toBe(true);
    expect(claimMessageFingerprint("s1", "assistant", "same")).toBe(false);
    releaseMessageFingerprint("s1", "assistant", "same");
    expect(claimMessageFingerprint("s1", "assistant", "same")).toBe(true);
    clearMessageFingerprintClaims();
  });

  it("shouldSkip combines recent and in-flight", () => {
    clearMessageFingerprintClaims();
    const msgs = [row("user", "hi")];
    expect(shouldSkipDuplicateSessionMessage("s1", msgs, "user", "hi")).toBe(true);
    expect(shouldSkipDuplicateSessionMessage("s1", [], "assistant", "new")).toBe(false);
    expect(claimMessageFingerprint("s1", "assistant", "new")).toBe(true);
    expect(shouldSkipDuplicateSessionMessage("s1", [], "assistant", "new")).toBe(true);
    clearMessageFingerprintClaims();
  });
});
