import { describe, expect, it } from "vitest";
import {
  isInternalDistributionProfile,
  validateConfigPatchForProfile,
} from "./console-control-stability";

describe("console-control-stability", () => {
  it("blocks yuntuai provider on internal profile", () => {
    const err = validateConfigPatchForProfile(
      { models: { providers: { yuntuai: { baseUrl: "x" } } } },
      "internal",
    );
    expect(err).toMatch(/内部版/);
  });

  it("accepts legacy deepseek-direct profile id", () => {
    expect(isInternalDistributionProfile("deepseek-direct")).toBe(true);
  });

  it("allows unrelated patch on internal", () => {
    const err = validateConfigPatchForProfile(
      { agents: { defaults: { timeoutSeconds: 7200 } } },
      "internal",
    );
    expect(err).toBeNull();
  });

  it("blocks yuntuai on relay profile", () => {
    const err = validateConfigPatchForProfile(
      { models: { providers: { yuntuai: { baseUrl: "x" } } } },
      "relay-station",
    );
    expect(err).toBeNull();
  });
});
