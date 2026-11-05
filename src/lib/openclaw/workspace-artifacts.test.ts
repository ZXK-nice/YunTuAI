import { describe, expect, it } from "vitest";
import { extractWorkspaceArtifacts } from "./workspace-artifacts";

describe("extractWorkspaceArtifacts", () => {
  it("extracts write paths from session.tool payload", () => {
    const found = extractWorkspaceArtifacts("session.tool", {
      name: "write_file",
      data: { path: "C:\\workspace\\output\\report.docx" },
    });
    expect(found.some((a) => a.path.includes("report.docx"))).toBe(true);
    expect(found[0]?.kind).toBe("write");
  });

  it("ignores non-tool events", () => {
    expect(extractWorkspaceArtifacts("chat", { message: "hi" })).toEqual([]);
  });
});
