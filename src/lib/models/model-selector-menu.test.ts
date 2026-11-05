import { describe, expect, it } from "vitest";
import { AUTO_MODEL_ID } from "../../types/model";
import {
  autoModelDetailLines,
  resolveDefaultDetailFocus,
  resolveDetailFocus,
} from "./model-selector-menu";

describe("model-selector-menu", () => {
  it("resolveDefaultDetailFocus returns auto for Auto selection", () => {
    expect(resolveDefaultDetailFocus(AUTO_MODEL_ID)).toBe("auto");
  });

  it("resolveDefaultDetailFocus returns catalog model for concrete id", () => {
    const m = resolveDefaultDetailFocus("qwen3.7-max");
    expect(m).not.toBe("auto");
    if (m !== "auto" && m !== null) {
      expect(m.id).toBe("qwen3.7-max");
      expect(m.tooltip).toBeTruthy();
    }
  });

  it("resolveDetailFocus prefers hovered model", () => {
    const hovered = resolveDefaultDetailFocus("deepseek-v4-pro");
    const m = resolveDetailFocus(hovered, "qwen3.7-max");
    expect(m).not.toBe("auto");
    if (m !== "auto" && m !== null) {
      expect(m.id).toBe("deepseek-v4-pro");
    }
  });

  it("resolveDetailFocus falls back to selection when not hovering", () => {
    const m = resolveDetailFocus(null, "qwen3.6-flash");
    expect(m).not.toBe("auto");
    if (m !== "auto" && m !== null) {
      expect(m.id).toBe("qwen3.6-flash");
    }
  });

  it("resolveDetailFocus shows auto detail when hovering auto", () => {
    expect(resolveDetailFocus("auto", "qwen3.7-max")).toBe("auto");
  });

  it("autoModelDetailLines mentions default model", () => {
    const lines = autoModelDetailLines("DeepSeek V4 Flash");
    expect(lines[0]).toContain("DeepSeek V4 Flash");
  });
});
