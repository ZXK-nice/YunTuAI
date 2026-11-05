import { describe, expect, it } from "vitest";
import {
  computeMethodCoverage,
  extractGatewayMethodsList,
  extractGatewayVersion,
  YUNTUAI_INTEGRATED_GATEWAY_METHODS,
} from "./gateway-method-coverage";

describe("gateway-method-coverage", () => {
  it("computes coverage against integrated method list", () => {
    const available = ["health", "status", "sessions.send", "chat.history"];
    const report = computeMethodCoverage(available, "2026.4.14");
    expect(report.gatewayVersion).toBe("2026.4.14");
    expect(report.integratedPresentCount).toBeGreaterThan(0);
    expect(report.coveragePercent).toBeLessThan(100);
    expect(report.missingIntegrated).toContain("sessions.compact");
  });

  it("extracts methods from list_methods response shapes", () => {
    expect(extractGatewayMethodsList({ methods: ["health", "status"] })).toEqual(["health", "status"]);
    expect(extractGatewayMethodsList(["a", "b"])).toEqual(["a", "b"]);
  });

  it("extracts gateway version from identity payload", () => {
    expect(extractGatewayVersion({ version: "1.2.3" })).toBe("1.2.3");
    expect(extractGatewayVersion({ identity: { version: "9.9.9" } })).toBe("9.9.9");
  });

  it("integrated list includes sessions.compact and logs.tail", () => {
    expect(YUNTUAI_INTEGRATED_GATEWAY_METHODS).toContain("sessions.compact");
    expect(YUNTUAI_INTEGRATED_GATEWAY_METHODS).toContain("logs.tail");
  });
});
