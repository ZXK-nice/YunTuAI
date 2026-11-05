import { describe, expect, it } from "vitest";
import { useUiStore } from "../uiStore";

describe("uiStore", () => {
  it("showToast sets active toast", () => {
    useUiStore.setState({ toast: null });
    useUiStore.getState().showToast("测试", "info");
    expect(useUiStore.getState().toast?.message).toBe("测试");
    expect(useUiStore.getState().toast?.variant).toBe("info");
  });

  it("requestNavToSettings stores navigation intent", () => {
    useUiStore.getState().requestNavToSettings("modules");
    expect(useUiStore.getState().navIntent?.kind).toBe("settings");
  });
});
