import { describe, expect, it } from "vitest";
import {
  buildTaskDeliverySummary,
  buildToolOnlyCompletionNotice,
  shouldPreferToolOnlyNotice,
} from "./task-delivery";
import type { PipelineStep } from "../../types/pipeline-step";
import type { WorkspaceArtifact } from "./workspace-artifacts";

function step(partial: Partial<PipelineStep> & Pick<PipelineStep, "id" | "title" | "status">): PipelineStep {
  return {
    startedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("task-delivery", () => {
  it("prefers tool-only notice when tools/artifacts succeeded", () => {
    const steps: PipelineStep[] = [
      step({ id: "1", title: "write", status: "success" }),
      step({ id: "2", title: "read", status: "success" }),
    ];
    const artifacts: WorkspaceArtifact[] = [
      { path: "E:/out/report.md", kind: "write", at: new Date().toISOString() },
    ];
    const summary = buildTaskDeliverySummary("s1", steps, artifacts);
    expect(summary.outcome).toBe("completed");
    expect(summary.steps?.length).toBe(2);
    expect(shouldPreferToolOnlyNotice(summary)).toBe(true);
    const notice = buildToolOnlyCompletionNotice(summary);
    expect(notice).toContain("【任务已执行】");
    expect(notice).toContain("report.md");
  });

  it("marks partial when some steps failed", () => {
    const steps: PipelineStep[] = [
      step({ id: "1", title: "ok", status: "success" }),
      step({ id: "2", title: "bad", status: "failed" }),
    ];
    const summary = buildTaskDeliverySummary("s2", steps, []);
    expect(summary.outcome).toBe("partial");
    expect(shouldPreferToolOnlyNotice(summary)).toBe(false);
  });

  it("is empty without steps/artifacts/text", () => {
    const summary = buildTaskDeliverySummary("s3", [], []);
    expect(summary.outcome).toBe("empty");
    expect(shouldPreferToolOnlyNotice(summary)).toBe(false);
  });

  it("marks cancelled when user stops", () => {
    const steps: PipelineStep[] = [
      step({ id: "1", title: "write", status: "success" }),
      step({ id: "2", title: "exec", status: "running" }),
    ];
    const summary = buildTaskDeliverySummary("s4", steps, [], { cancelled: true });
    expect(summary.outcome).toBe("cancelled");
    expect(summary.headline).toContain("取消");
  });

  it("resetTaskDeliveryState clears session summaries", async () => {
    const { hydrateTaskDeliverySummary, getTaskDeliverySummary, resetTaskDeliveryState } =
      await import("./task-delivery");
    hydrateTaskDeliverySummary({
      sessionId: "s-reset",
      at: new Date().toISOString(),
      stepTotal: 0,
      stepFailed: 0,
      stepSuccess: 0,
      artifactCount: 0,
      artifactPaths: [],
      outcome: "empty",
      headline: "tmp",
      detail: "",
    });
    expect(getTaskDeliverySummary("s-reset")?.headline).toBe("tmp");
    resetTaskDeliveryState();
    expect(getTaskDeliverySummary("s-reset")).toBeNull();
  });
});
