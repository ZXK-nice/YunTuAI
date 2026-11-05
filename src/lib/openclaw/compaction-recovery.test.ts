import { describe, expect, it } from "vitest";
import { isCompactionRecoveryError, humanizeCompactionRecoveryError } from "./compaction-recovery";

describe("isCompactionRecoveryError", () => {
  it("detects auto-compaction failure", () => {
    expect(
      isCompactionRecoveryError(
        "Auto-compaction could not recover this turn. Please try again, use `/compact`, or use `/new`.",
      ),
    ).toBe(true);
  });

  it("detects reserveTokensFloor hint", () => {
    expect(
      isCompactionRecoveryError(
        "increase agents.defaults.compaction.reserveTokensFloor to 20000",
      ),
    ).toBe(true);
  });

  it("humanizes compaction failure for users", () => {
    expect(
      humanizeCompactionRecoveryError(
        "Auto-compaction could not recover this turn.",
      ),
    ).toContain("对话上下文过长");
  });
});
