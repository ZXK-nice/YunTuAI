import { describe, expect, it } from "vitest";
import type { EnvKeyRequirement } from "../openclaw/env-bridge";
import {
  configuredDirectProviders,
  defaultModelIdForProviders,
  filterModelOptionsByKeys,
  filterProviderGroupsByKeys,
  isModelAllowedForKeys,
} from "./available-by-key";
import { listModelProviderGroups } from "./catalog";
import { INTERNAL_PROFILE_ID, RELAY_PROFILE_ID } from "../distribution-profile";

function key(id: string, configured: boolean): EnvKeyRequirement {
  return { id, label: id, hint: "", configured, required: false };
}

describe("available-by-key", () => {
  it("picks DeepSeek default when only DeepSeek key is configured", () => {
    const providers = configuredDirectProviders([
      key("DEEPSEEK_API_KEY", true),
      key("MIMO_API_KEY", false),
    ]);
    expect([...providers]).toEqual(["deepseek"]);
    expect(defaultModelIdForProviders(providers)).toBe("deepseek-flash");
  });

  it("prefers DeepSeek when multiple keys exist", () => {
    const providers = configuredDirectProviders([
      key("MIMO_API_KEY", true),
      key("DEEPSEEK_API_KEY", true),
    ]);
    expect(defaultModelIdForProviders(providers)).toBe("deepseek-flash");
  });

  it("hides unconfigured vendors on internal profile", () => {
    const groups = listModelProviderGroups(INTERNAL_PROFILE_ID);
    const filtered = filterProviderGroupsByKeys(groups, {
      profileId: INTERNAL_PROFILE_ID,
      allowedProviders: new Set(["deepseek"]),
    });
    expect(filtered.map((g) => g.provider)).toEqual(["deepseek"]);
    expect(isModelAllowedForKeys("mimo-v2.5", new Set(["deepseek"]), INTERNAL_PROFILE_ID)).toBe(
      false,
    );
    expect(
      isModelAllowedForKeys("deepseek-v4-pro", new Set(["deepseek"]), INTERNAL_PROFILE_ID),
    ).toBe(true);
  });

  it("filters settings model options by configured vendor", () => {
    const options = [
      { id: "mimo-v2.5", label: "MiMo" },
      { id: "deepseek-v4-flash", label: "Flash" },
      { id: "qwen3.6-flash", label: "Qwen" },
    ];
    const filtered = filterModelOptionsByKeys(options, {
      profileId: INTERNAL_PROFILE_ID,
      allowedProviders: new Set(["qwen"]),
      keepId: "mimo-v2.5",
    });
    expect(filtered.map((m) => m.id)).toEqual(["mimo-v2.5", "qwen3.6-flash"]);
  });

  it("does not filter relay-station catalog", () => {
    const groups = listModelProviderGroups(RELAY_PROFILE_ID);
    const filtered = filterProviderGroupsByKeys(groups, {
      profileId: RELAY_PROFILE_ID,
      allowedProviders: new Set(["deepseek"]),
    });
    expect(filtered.length).toBe(groups.length);
  });
});
