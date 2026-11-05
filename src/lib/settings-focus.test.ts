import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { settingsFocusTargetId, scrollToSettingsFocus } from "./settings-focus";

describe("settings-focus", () => {
  describe("settingsFocusTargetId", () => {
    it("maps known focus keys to element ids", () => {
      expect(settingsFocusTargetId("modules")).toBe("module-manager");
      expect(settingsFocusTargetId("kb-assistant")).toBe("kb-assistant-settings");
      expect(settingsFocusTargetId("software")).toBe("software-settings");
      expect(settingsFocusTargetId("license")).toBe("license-status");
      expect(settingsFocusTargetId("license-issuer")).toBe("license-issuer");
      expect(settingsFocusTargetId("owner-unlock")).toBe("owner-unlock");
    });
  });

  describe("scrollToSettingsFocus", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      document.body.innerHTML = "";
    });

    it("scrolls to target and calls onComplete", () => {
      const el = document.createElement("div");
      el.id = "license-status";
      el.scrollIntoView = vi.fn();
      document.body.appendChild(el);

      const done = vi.fn();
      const onSwitchTab = vi.fn();
      scrollToSettingsFocus("license", true, done, { onSwitchTab });
      vi.runAllTimers();

      expect(onSwitchTab).toHaveBeenCalledWith("account");
      expect(el.scrollIntoView).toHaveBeenCalled();
      expect(done).toHaveBeenCalled();
    });

    it("redirects license-issuer to owner-unlock when not unlocked", () => {
      const unlock = document.createElement("div");
      unlock.id = "owner-unlock";
      unlock.scrollIntoView = vi.fn();
      document.body.appendChild(unlock);

      const done = vi.fn();
      scrollToSettingsFocus("license-issuer", false, done);
      vi.runAllTimers();

      expect(unlock.scrollIntoView).toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
    });
  });
});
