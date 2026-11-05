import { describe, expect, it } from "vitest";
import { describeExecApproval } from "./exec-approval-copy";
import type { ExecApprovalRequest } from "./exec-approval";

function execEntry(command: string, resolvedPath?: string): ExecApprovalRequest {
  return {
    id: "1",
    kind: "exec",
    request: {
      command,
      resolvedPath: resolvedPath ?? null,
    },
    createdAtMs: 1,
    expiresAtMs: 9999999999999,
  };
}

describe("describeExecApproval", () => {
  it("describes xlsx write in plain language", () => {
    const copy = describeExecApproval(
      execEntry(
        "powershell -File yuntu-office-write.ps1 -OutPath D:\\out\\结果.xlsx",
        "D:\\out\\结果.xlsx",
      ),
    );
    expect(copy.summary).toContain("结果.xlsx");
    expect(copy.summary).toContain("允许");
    expect(copy.risky).toBe(false);
  });

  it("marks npm install as risky", () => {
    const copy = describeExecApproval(execEntry("npm install pandas"));
    expect(copy.risky).toBe(true);
    expect(copy.title).toContain("高风险");
  });
});
