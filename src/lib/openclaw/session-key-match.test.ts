import { describe, expect, it } from "vitest";
import { findLocalSessionByRemoteKey } from "./session-key-match";

describe("findLocalSessionByRemoteKey", () => {
  const sessions = [
    { id: "local-1", remoteSessionKey: "agent:main:thread-abc" },
    { id: "local-2", remoteSessionKey: "agent:main:thread-XYZ" },
    { id: "local-3", remoteSessionKey: null },
  ];

  it("matches exact session key", () => {
    expect(findLocalSessionByRemoteKey("agent:main:thread-abc", sessions)?.id).toBe("local-1");
  });

  it("matches case-insensitively", () => {
    expect(findLocalSessionByRemoteKey("agent:main:thread-xyz", sessions)?.id).toBe("local-2");
  });

  it("returns null when no match", () => {
    expect(findLocalSessionByRemoteKey("agent:main:missing", sessions)).toBeNull();
  });

  it("returns null for empty key", () => {
    expect(findLocalSessionByRemoteKey("  ", sessions)).toBeNull();
  });
});
