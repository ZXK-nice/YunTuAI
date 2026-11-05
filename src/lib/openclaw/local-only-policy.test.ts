import { describe, expect, it } from "vitest";
import { LOCAL_ONLY_TOOL_DENY_PATTERNS } from "./local-only-policy";

describe("local-only-policy", () => {
  it("denylist covers common outbound tools", () => {
    expect(LOCAL_ONLY_TOOL_DENY_PATTERNS).toContain("web_search");
    expect(LOCAL_ONLY_TOOL_DENY_PATTERNS).toContain("http");
    expect(LOCAL_ONLY_TOOL_DENY_PATTERNS.length).toBeGreaterThan(5);
  });
});
