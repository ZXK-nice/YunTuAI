import { describe, expect, it } from "vitest";
import { statusFromDelivery } from "../../stores/taskStore";
import type { TaskDeliverySummary } from "./task-delivery";

function summary(partial: Partial<TaskDeliverySummary>): TaskDeliverySummary {
  return {
    sessionId: "s1",
    at: new Date().toISOString(),
    stepTotal: 0,
    stepFailed: 0,
    stepSuccess: 0,
    artifactCount: 0,
    artifactPaths: [],
    outcome: "empty",
    headline: "x",
    detail: "",
    ...partial,
  };
}

describe("statusFromDelivery", () => {
  it("maps outcomes", () => {
    expect(statusFromDelivery(summary({ outcome: "failed" }))).toBe("failed");
    expect(statusFromDelivery(summary({ outcome: "partial" }))).toBe("partial");
    expect(statusFromDelivery(summary({ outcome: "completed" }))).toBe("completed");
    expect(statusFromDelivery(summary({ outcome: "empty" }))).toBe("completed");
  });
});
