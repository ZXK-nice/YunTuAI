import { describe, expect, it } from "vitest";
import { parseHealthLooksOk } from "./gateway-health-probe";

describe("parseHealthLooksOk", () => {
  it("requires healthy JSON, not merely CLI ok", () => {
    expect(parseHealthLooksOk({ ok: true, stdout: "", stderr: "", exitCode: 0 })).toBe("unknown");
    expect(
      parseHealthLooksOk({
        ok: true,
        stdout: '{"ok":true,"status":"running"}',
        stderr: "",
        exitCode: 0,
      }),
    ).toBe("ok");
    expect(
      parseHealthLooksOk({
        ok: true,
        stdout: '{"ok":false,"error":"unavailable"}',
        stderr: "",
        exitCode: 0,
      }),
    ).toBe("down");
  });
});
