import { afterEach, describe, expect, it } from "vitest";
import { AUTO_MODEL_ID, DEFAULT_MODEL_ID } from "../../types/model";
import {
  buildModelMenuEntries,
  catalogForProfile,
  displayLabelForSelection,
  getCatalogModel,
  listModelProviderGroups,
  modelUsesDirectVision,
  resolveSelectionToModelId,
  resolveVendorForSelection,
} from "./catalog";
import { INTERNAL_PROFILE_ID } from "../distribution-profile";
import {
  resetRuntimeDefaultModelIdForTest,
  setRuntimeDefaultModelId,
} from "./runtime-default-model";

describe("model catalog", () => {
  afterEach(() => {
    resetRuntimeDefaultModelIdForTest();
  });

  it("internal profile exposes deepseek models", () => {
    const catalog = catalogForProfile(INTERNAL_PROFILE_ID);
    const ids = catalog.map((m) => m.id);
    expect(ids).toContain("deepseek-flash");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).not.toContain("deepseek-v4-flash");
    expect(ids.filter((id) => id.startsWith("agnes-"))).toEqual([]);
  });

  it("relay catalog matches the station shelf and blocks self-serve vendors", () => {
    const ids = catalogForProfile("relay-station").map((m) => m.id);
    expect(ids).toHaveLength(32);
    expect(ids).toContain("glm-5.2");
    expect(ids).toContain("hy3-preview");
    expect(ids).not.toContain("qwen3.6-flash");
    expect(ids).not.toContain("mimo-v2.5");
  });

  it("legacy deepseek-direct profile id uses internal catalog", () => {
    const catalog = catalogForProfile("deepseek-direct");
    expect(catalog.map((m) => m.id)).toContain("mimo-v2.5");
  });

  it("menu entries always include Auto first", () => {
    const entries = buildModelMenuEntries(INTERNAL_PROFILE_ID);
    expect(entries[0]).toMatchObject({ kind: "auto", id: AUTO_MODEL_ID });
    expect(entries.some((e) => e.kind === "model" && e.model.id === DEFAULT_MODEL_ID)).toBe(
      true,
    );
  });

  it("resolveSelectionToModelId maps Auto to runtime default", () => {
    expect(resolveSelectionToModelId(AUTO_MODEL_ID)).toBe(DEFAULT_MODEL_ID);
    setRuntimeDefaultModelId("deepseek-flash");
    expect(resolveSelectionToModelId(AUTO_MODEL_ID)).toBe("deepseek-flash");
    expect(resolveSelectionToModelId("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("internal profile exposes qwen models", () => {
    const catalog = catalogForProfile(INTERNAL_PROFILE_ID);
    const ids = catalog.map((m) => m.id);
    expect(ids).toContain("qwen3.6-flash");
    expect(ids).toContain("qwen3.7-max");
  });

  it("internal profile exposes mimo models", () => {
    const catalog = catalogForProfile(INTERNAL_PROFILE_ID);
    const ids = catalog.map((m) => m.id);
    expect(ids).toContain("mimo-v2.5-pro");
    expect(ids).toContain("mimo-v2.5");
  });

  it("modelUsesDirectVision is true for qwen, mimo omni, and DeepSeek Flash", () => {
    expect(modelUsesDirectVision("qwen3.6-flash")).toBe(true);
    expect(modelUsesDirectVision("deepseek-flash")).toBe(true);
    expect(modelUsesDirectVision("deepseek-v4-flash")).toBe(true);
    expect(modelUsesDirectVision("deepseek-v4-pro")).toBe(true);
    expect(modelUsesDirectVision("mimo-v2.5")).toBe(true);
    expect(modelUsesDirectVision("mimo-v2.5-pro")).toBe(false);
  });

  it("mimo catalog includes price tooltips", () => {
    const pro = getCatalogModel("mimo-v2.5-pro");
    const omni = getCatalogModel("mimo-v2.5");
    expect(pro?.tooltip?.inputPricePerMillionCny).toBe(3);
    expect(omni?.tooltip?.inputPricePerMillionCny).toBe(1);
  });

  it("displayLabelForSelection", () => {
    expect(displayLabelForSelection(AUTO_MODEL_ID)).toBe("Auto");
    expect(displayLabelForSelection("deepseek-flash")).toBe("DeepSeek V4.1 Flash");
    expect(displayLabelForSelection("mimo-v2.5")).toBe("MiMo V2.5");
    expect(displayLabelForSelection("MiMo-V2.6-Pro")).toBe("MiMo V2.6 Pro");
    expect(resolveSelectionToModelId("MiMo-V2.6-Pro")).toBe("mimo-v2.6-pro");
  });

  it("resolveVendorForSelection prefers current model vendor then DeepSeek", () => {
    const groups = listModelProviderGroups(INTERNAL_PROFILE_ID);
    expect(resolveVendorForSelection("qwen3.6-flash", groups)).toBe("qwen");
    expect(resolveVendorForSelection(AUTO_MODEL_ID, groups)).toBe("deepseek");
    expect(resolveVendorForSelection("unknown-model", groups)).toBe("deepseek");
  });
});
