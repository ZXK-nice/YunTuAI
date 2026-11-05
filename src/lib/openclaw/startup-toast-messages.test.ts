import { describe, expect, it } from "vitest";
import { resolveExclusiveStartupToast } from "./startup-toast-messages";

const base = {
  supervisor: { running: false, pid: null },
  externalGatewayConflict: false,
  globalOpenclawInPath: false,
  warnings: [] as string[],
};

describe("resolveExclusiveStartupToast", () => {
  it("returns error when external gateway conflicts", () => {
    const toast = resolveExclusiveStartupToast({
      ...base,
      externalGatewayConflict: true,
    });
    expect(toast?.variant).toBe("error");
    expect(toast?.message).toContain("回收控制权");
  });

  it("returns info when global openclaw is on PATH", () => {
    const toast = resolveExclusiveStartupToast({
      ...base,
      globalOpenclawInPath: true,
    });
    expect(toast?.variant).toBe("info");
    expect(toast?.message).toContain("全局本机版");
  });

  it("returns success when supervisor is running", () => {
    const toast = resolveExclusiveStartupToast({
      ...base,
      supervisor: { running: true, pid: 1234 },
    });
    expect(toast?.variant).toBe("success");
    expect(toast?.message).toContain("PID 1234");
  });

  it("returns null when only internal supervisor warnings exist", () => {
    const toast = resolveExclusiveStartupToast({
      ...base,
      warnings: ["网关由 YunTu Control 独占监管"],
    });
    expect(toast).toBeNull();
  });

  it("joins actionable warnings", () => {
    const toast = resolveExclusiveStartupToast({
      ...base,
      warnings: ["端口被占用", "配置未封存"],
    });
    expect(toast?.message).toBe("端口被占用；配置未封存");
  });
});
