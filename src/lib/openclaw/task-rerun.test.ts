import { describe, expect, it } from "vitest";
import { parseReplayPrompt } from "./task-rerun";
import type { LocalTaskRow } from "../../stores/taskStore";

function task(partial: Partial<LocalTaskRow>): LocalTaskRow {
  return {
    id: "t1",
    sessionId: "s1",
    title: "办事任务",
    status: "failed",
    createdAt: "1",
    updatedAt: "1",
    ...partial,
  };
}

describe("parseReplayPrompt", () => {
  it("reads replayPrompt from capabilitySnapshot", () => {
    const p = parseReplayPrompt(
      task({
        capabilitySnapshot: JSON.stringify({ replayPrompt: "请生成报告" }),
      }),
    );
    expect(p).toBe("请生成报告");
  });

  it("falls back to title when useful", () => {
    expect(parseReplayPrompt(task({ title: "帮我写邮件" }))).toBe("帮我写邮件");
    expect(parseReplayPrompt(task({ title: "办事任务" }))).toBeNull();
  });
});
