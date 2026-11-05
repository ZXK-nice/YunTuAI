import { describe, expect, it } from "vitest";
import {
  isKbAssistantAgentId,
  resolveEffectiveAgentIdForSend,
  resolveModelSelectionForSend,
  sessionAgentMatchesActive,
} from "./kb-assistant-send-policy";

describe("kb-assistant-send-policy", () => {
  it("detects kb-assistant id", () => {
    expect(isKbAssistantAgentId("kb-assistant")).toBe(true);
    expect(isKbAssistantAgentId("main")).toBe(false);
  });

  it("prefers session agent over header selection", () => {
    expect(resolveEffectiveAgentIdForSend("main", "kb-assistant")).toBe("main");
    expect(resolveEffectiveAgentIdForSend(null, "kb-assistant")).toBe("kb-assistant");
  });

  it("keeps the model the user selected, including on kb-assistant", () => {
    expect(
      resolveModelSelectionForSend({
        sessionAgentId: "kb-assistant",
        activeAgentId: "kb-assistant",
        uiSelectionId: "MiMo-V2.6-Pro",
      }),
    ).toBe("MiMo-V2.6-Pro");
  });

  it("checks session/header agent alignment", () => {
    expect(sessionAgentMatchesActive("main", "kb-assistant")).toBe(false);
    expect(sessionAgentMatchesActive("kb-assistant", "kb-assistant")).toBe(true);
    expect(sessionAgentMatchesActive(null, "kb-assistant")).toBe(false);
  });
});
