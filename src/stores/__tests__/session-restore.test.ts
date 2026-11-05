import { describe, expect, it, beforeEach } from "vitest";
import { restoreLastActiveSessionAfterLoad, useSessionStore, type LocalSessionRow } from "../sessionStore";

const LAST_ACTIVE_SESSION_KEY = "yuntuai.lastActiveSessionId";

function makeSession(
  id: string,
  createdAt: string,
  lastMessageAt?: string,
): LocalSessionRow {
  return {
    id,
    title: id,
    remoteSessionKey: null,
    agentId: null,
    createdAt,
    updatedAt: createdAt,
    lastMessageAt,
  };
}

describe("restoreLastActiveSessionAfterLoad", () => {
  beforeEach(() => {
    localStorage.clear();
    useSessionStore.setState({
      sessions: [
        makeSession("old", "1000", "5000"),
        makeSession("new", "9000", "3000"),
      ],
      activeId: null,
    });
  });

  it("restores the persisted active session", () => {
    localStorage.setItem(LAST_ACTIVE_SESSION_KEY, "new");
    restoreLastActiveSessionAfterLoad();
    expect(useSessionStore.getState().activeId).toBe("new");
  });

  it("keeps compose mode when user last opened new chat", () => {
    restoreLastActiveSessionAfterLoad();
    expect(useSessionStore.getState().activeId).toBeNull();
  });

  it("does not auto-open an old session when compose was active", () => {
    restoreLastActiveSessionAfterLoad();
    expect(useSessionStore.getState().activeId).not.toBe("old");
  });

  it("falls back to compose mode when stored id was deleted", () => {
    localStorage.setItem(LAST_ACTIVE_SESSION_KEY, "deleted");
    restoreLastActiveSessionAfterLoad();
    expect(useSessionStore.getState().activeId).toBeNull();
  });
});
