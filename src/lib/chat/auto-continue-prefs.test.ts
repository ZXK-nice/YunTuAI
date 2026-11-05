import { describe, expect, it } from "vitest";
import {
  persistAutoContinueIncomplete,
  readAutoContinueIncomplete,
} from "./auto-continue-prefs";

describe("auto-continue-prefs", () => {
  it("defaults to on and persists off as 0", () => {
    localStorage.removeItem("yuntu-auto-continue-incomplete-v1");
    expect(readAutoContinueIncomplete()).toBe(true);
    persistAutoContinueIncomplete(false);
    expect(localStorage.getItem("yuntu-auto-continue-incomplete-v1")).toBe("0");
    expect(readAutoContinueIncomplete()).toBe(false);
    persistAutoContinueIncomplete(true);
    expect(readAutoContinueIncomplete()).toBe(true);
  });
});
