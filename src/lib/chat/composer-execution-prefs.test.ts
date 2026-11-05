import { describe, expect, it } from "vitest";
import { shouldSuggestLocalOnly, persistLocalOnlyMode, readLocalOnlyMode } from "./composer-execution-prefs";

describe("composer-execution-prefs", () => {
  it("suggests local only for sensitive text", () => {
    expect(shouldSuggestLocalOnly("核对财务合同")).toBe(true);
    expect(shouldSuggestLocalOnly("写周报")).toBe(false);
  });

  it("persists local only flag", () => {
    persistLocalOnlyMode(true);
    expect(readLocalOnlyMode()).toBe(true);
    persistLocalOnlyMode(false);
    expect(readLocalOnlyMode()).toBe(false);
  });
});
