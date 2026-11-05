import { describe, expect, it } from "vitest";
import { humanizeConnectError } from "./connect-error-copy";

describe("humanizeConnectError", () => {
  it("maps api key errors", () => {
    expect(humanizeConnectError("DEEPSEEK_API_KEY missing")).toMatch(/任意一家/);
  });

  it("maps localhost failures", () => {
    expect(humanizeConnectError("connect 127.0.0.1:18789 refused")).toMatch(/本机服务/);
  });

  it("does not leak OpenClaw in exclusive conflicts", () => {
    const out = humanizeConnectError("external OpenClaw process exclusive conflict");
    expect(out).toMatch(/本机服务/);
    expect(out?.toLowerCase()).not.toContain("openclaw");
  });
});
