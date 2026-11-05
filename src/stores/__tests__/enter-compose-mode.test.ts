import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../sessionStore";
import { useUiStore } from "../uiStore";

describe("enterComposeMode", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({
      composerDrafts: {},
      composeResetTick: 0,
    });
    useSessionStore.setState({
      activeId: "sess-a",
      sessions: [],
      messagesBySession: {
        "sess-a": [],
        "sess-b": [{ id: "m1", sessionId: "sess-b", role: "user", content: "hi", createdAt: "1" }],
      },
      streamingDraftBySession: { "sess-a": "stream", "sess-b": "think" },
      thinkingDraftBySession: { "sess-b": "t" },
    });
  });

  it("clears __new__ draft and bumps compose reset tick", () => {
    useUiStore.getState().setComposerDraft("__new__", "残留草稿");
    const tickBefore = useUiStore.getState().composeResetTick;

    useSessionStore.getState().enterComposeMode();

    expect(useSessionStore.getState().activeId).toBeNull();
    expect(useUiStore.getState().composerDrafts["__new__"]).toBeUndefined();
    expect(useUiStore.getState().composeResetTick).toBe(tickBefore + 1);
  });
});
