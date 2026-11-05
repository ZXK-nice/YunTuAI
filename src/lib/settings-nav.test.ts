import { describe, expect, it } from "vitest";
import { settingsFocusToTab } from "./settings-nav";

describe("settings-nav", () => {
  it("maps focus keys to settings tabs", () => {
    expect(settingsFocusToTab("software")).toBe("general");
    expect(settingsFocusToTab("output-dir")).toBe("general");
    expect(settingsFocusToTab("license")).toBe("account");
    expect(settingsFocusToTab("modules")).toBe("service");
    expect(settingsFocusToTab("kb-assistant")).toBe("service");
    expect(settingsFocusToTab("owner-unlock")).toBe("advanced");
    expect(settingsFocusToTab("license-issuer")).toBe("advanced");
  });
});
