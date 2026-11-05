import { describe, expect, it } from "vitest";
import { isMainHubView } from "./session-view";

describe("isMainHubView", () => {
  it("includes skillStudio without right task panel", () => {
    expect(isMainHubView("imageStudio", "chat")).toBe(true);
    expect(isMainHubView("skillStudio", "chat")).toBe(true);
  });

  it("keeps existing main hub views", () => {
    expect(isMainHubView("agents", "chat")).toBe(true);
    expect(isMainHubView("sessions", "chat")).toBe(true);
    expect(isMainHubView("sessions", "tools")).toBe(true);
    expect(isMainHubView("settings", "chat")).toBe(false);
  });
});
