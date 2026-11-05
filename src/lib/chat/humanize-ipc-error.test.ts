import { describe, expect, it } from "vitest";
import { humanizeIpcError } from "./humanize-ipc-error";

describe("humanizeIpcError", () => {
  it("maps permission and timeout errors", () => {
    expect(humanizeIpcError("EACCES: permission denied")).toBe("无权限访问该文件");
    expect(humanizeIpcError("request timed out")).toBe("操作超时，请稍后重试");
  });

  it("keeps short Chinese messages", () => {
    expect(humanizeIpcError("Owner 未配置，无法验证。")).toBe("Owner 未配置，无法验证。");
  });

  it("falls back for unknown English", () => {
    expect(humanizeIpcError("unexpected internal failure")).toBe("操作失败，请重试或查看日志");
  });
});
