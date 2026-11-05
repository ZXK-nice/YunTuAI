import { describe, expect, it } from "vitest";
import { shouldScheduleExternalJobFollowUp } from "./external-job-followup";

const JOB = "337f0385-378b-4419-bb89-5422f052cac2";

describe("external-job-followup", () => {
  it("schedules when interim status mentions job id", () => {
    const text = `已入队执行
- job_id: ${JOB}
后台轮询跟踪中`;
    expect(shouldScheduleExternalJobFollowUp(text)).toBe(true);
  });

  it("does not schedule when terminal report already present", () => {
    const text = `job ${JOB} completed
| 抖音 | ok | success |
| 快手 | ok | success |
| 小红书 | ok | failed |`;
    expect(shouldScheduleExternalJobFollowUp(text)).toBe(false);
  });
});
