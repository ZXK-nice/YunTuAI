import { describe, expect, it } from "vitest";
import { parseCronJobs, parseGatewaySessions, parseSkillStatus } from "./console-parse";

describe("parseCronJobs", () => {
  it("reads jobs array", () => {
    const jobs = parseCronJobs({
      jobs: [{ id: "daily", schedule: "0 9 * * *", enabled: true }],
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("daily");
  });
});

describe("parseGatewaySessions", () => {
  it("reads session keys", () => {
    const rows = parseGatewaySessions({
      sessions: [{ sessionKey: "agent:main:abc", label: "Test" }],
    });
    expect(rows[0]?.key).toBe("agent:main:abc");
    expect(rows[0]?.label).toBe("Test");
  });
});

describe("parseSkillStatus", () => {
  it("reads entries map", () => {
    const skills = parseSkillStatus({
      entries: { demo: { enabled: false, description: "x" } },
    });
    expect(skills[0]?.name).toBe("demo");
    expect(skills[0]?.enabled).toBe(false);
  });
});
