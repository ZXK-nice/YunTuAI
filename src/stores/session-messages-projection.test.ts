import { describe, expect, it } from "vitest";
import {
  appendMessageToSessionMap,
  messagesForSession,
  patchLastUserSendStatusInMap,
} from "./session-messages-projection";
import type { LocalMessageRow } from "./session-store-types";

function row(partial: Partial<LocalMessageRow> & Pick<LocalMessageRow, "id" | "role">): LocalMessageRow {
  return {
    sessionId: "s1",
    content: "hi",
    createdAt: "1",
    ...partial,
  };
}

describe("session-messages-projection", () => {
  it("returns empty list for missing session", () => {
    expect(messagesForSession({}, null)).toEqual([]);
    expect(messagesForSession({ s1: [row({ id: "m1", role: "user" })] }, "s2")).toEqual([]);
  });

  it("appends and patches the last user sendStatus", () => {
    let map = appendMessageToSessionMap({}, "s1", row({ id: "u1", role: "user" }));
    map = appendMessageToSessionMap(map, "s1", row({ id: "a1", role: "assistant", content: "ok" }));
    map = patchLastUserSendStatusInMap(map, "s1", "failed");
    expect(messagesForSession(map, "s1")[0]?.sendStatus).toBe("failed");
    expect(messagesForSession(map, "s1")[1]?.sendStatus).toBeUndefined();
  });
});
