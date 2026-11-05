import { describe, expect, it, vi } from "vitest";
import { qualifyOpenClawModelId } from "./session-model";

vi.mock("./env-bridge", () => ({
  fetchDistributionProfile: vi.fn(async () => ({
    profile: "internal",
    defaultModelId: "mimo-v2.5",
  })),
}));

describe("qualifyOpenClawModelId", () => {
  it("routes MiMo models to mimo provider (not deepseek)", async () => {
    await expect(qualifyOpenClawModelId("mimo-v2.5")).resolves.toBe("mimo/mimo-v2.5");
    await expect(qualifyOpenClawModelId("mimo-v2.5-pro")).resolves.toBe("mimo/mimo-v2.5-pro");
  });

  it("routes DeepSeek catalog models to deepseek provider", async () => {
    await expect(qualifyOpenClawModelId("deepseek-flash")).resolves.toBe("deepseek/deepseek-flash");
    await expect(qualifyOpenClawModelId("deepseek-v4-flash")).resolves.toBe(
      "deepseek/deepseek-v4-flash",
    );
  });

  it("routes qwen models to qwen provider", async () => {
    await expect(qualifyOpenClawModelId("qwen-plus")).resolves.toBe("qwen/qwen-plus");
  });

  it("passes through fully qualified ids", async () => {
    await expect(qualifyOpenClawModelId("mimo/mimo-v2.5")).resolves.toBe("mimo/mimo-v2.5");
  });

  it("routes user-added vendor ids away from deepseek", async () => {
    await expect(qualifyOpenClawModelId("glm-4.7")).resolves.toBe("zhipu/glm-4.7");
    await expect(qualifyOpenClawModelId("kimi-k2.5")).resolves.toBe("moonshot/kimi-k2.5");
  });

  it("keeps the user model name and only fixes the provider", async () => {
    await expect(qualifyOpenClawModelId("MiMo-V2.6-Pro")).resolves.toBe("mimo/mimo-v2.6-pro");
    await expect(qualifyOpenClawModelId("deepseek/MiMo-V2.6-Pro")).resolves.toBe(
      "mimo/mimo-v2.6-pro",
    );
  });

  it("sends a user slot to that slot's provider, including ids that contain a slash", async () => {
    const { setUserCatalogModels } = await import("../models/catalog");
    setUserCatalogModels([
      {
        id: "deepseek-ai/DeepSeek-V3.2",
        label: "硅基",
        provider: "siliconflow",
        capabilities: ["tools"],
      },
      {
        id: "my-custom-model",
        label: "自定义",
        provider: "custom",
        capabilities: ["tools"],
      },
    ]);
    await expect(qualifyOpenClawModelId("deepseek-ai/DeepSeek-V3.2")).resolves.toBe(
      "siliconflow/deepseek-ai/DeepSeek-V3.2",
    );
    await expect(qualifyOpenClawModelId("my-custom-model")).resolves.toBe("custom/my-custom-model");
    setUserCatalogModels([]);
  });
});
