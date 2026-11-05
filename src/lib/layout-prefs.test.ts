import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  headerNavModeFromLevel,
  headerNavModeToLevel,
  readHeaderNavMode,
  persistHeaderNavMode,
} from "./layout-prefs";

describe("layout-prefs header nav mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to collapsed", () => {
    expect(readHeaderNavMode()).toBe("collapsed");
  });

  it("persists selected mode", () => {
    persistHeaderNavMode("expanded");
    expect(readHeaderNavMode()).toBe("expanded");
  });

  it("maps slider levels", () => {
    expect(headerNavModeFromLevel(0)).toBe("collapsed");
    expect(headerNavModeFromLevel(1)).toBe("normal");
    expect(headerNavModeFromLevel(2)).toBe("expanded");
    expect(headerNavModeToLevel("normal")).toBe(1);
  });
});
