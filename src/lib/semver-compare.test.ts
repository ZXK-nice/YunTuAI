import { describe, expect, it } from "vitest";
import { isVersionNewer } from "./semver-compare";

describe("isVersionNewer", () => {
  it("detects patch bump", () => {
    expect(isVersionNewer("1.1.1", "1.1.0")).toBe(true);
  });

  it("detects minor bump", () => {
    expect(isVersionNewer("1.2.0", "1.1.0")).toBe(true);
  });

  it("rejects same or older", () => {
    expect(isVersionNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isVersionNewer("1.0.9", "1.1.0")).toBe(false);
  });
});
