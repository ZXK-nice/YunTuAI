import { describe, expect, it } from "vitest";
import {
  GATEWAY_PREPARE_MAX_MS,
  GATEWAY_RECOVERY_TIMEOUT_MS,
} from "./gateway-recovery-policy";

describe("gateway-recovery-policy", () => {
  it("uses aligned recovery and prepare timeouts", () => {
    expect(GATEWAY_RECOVERY_TIMEOUT_MS).toBe(45_000);
    expect(GATEWAY_PREPARE_MAX_MS).toBe(30_000);
    expect(GATEWAY_RECOVERY_TIMEOUT_MS).toBeGreaterThan(GATEWAY_PREPARE_MAX_MS);
  });
});
