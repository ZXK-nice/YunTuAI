import { describe, expect, it } from "vitest";
import { sessionActivityAt, sortSessionsByActivity } from "./session-sort";

describe("sortSessionsByActivity", () => {
  it("orders by lastMessageAt when present", () => {
    const sorted = sortSessionsByActivity([
      { id: "a", updatedAt: "500", createdAt: "10", lastMessageAt: "100" },
      { id: "b", updatedAt: "900", createdAt: "20", lastMessageAt: "300" },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("prefers last message over stale updatedAt", () => {
    expect(
      sessionActivityAt({ updatedAt: "900", createdAt: "1", lastMessageAt: "200" }),
    ).toBe("200");
  });

  it("uses id as final tiebreaker for stable ordering", () => {
    const sorted = sortSessionsByActivity([
      { id: "a", updatedAt: "100", createdAt: "10", lastMessageAt: "100" },
      { id: "b", updatedAt: "100", createdAt: "10", lastMessageAt: "100" },
      { id: "c", updatedAt: "100", createdAt: "10", lastMessageAt: "100" },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "a"]);
  });
});
