import { describe, expect, it } from "vitest";
import { humanizeIpcFailure, isIpcTimeoutError } from "./async-utils";

describe("humanizeIpcFailure", () => {
  it("maps raw invoke timeouts", () => {
    expect(isIpcTimeoutError("db_list_sessions 超时 (10000ms)")).toBe(true);
    expect(humanizeIpcFailure("db_list_sessions 超时 (10000ms)")).toMatch(/本机正在启动/);
    expect(humanizeIpcFailure("db_list_sessions 超时 (10000ms)")).not.toContain("db_list");
  });

  it("leaves unrelated errors intact", () => {
    expect(humanizeIpcFailure("磁盘已满")).toBe("磁盘已满");
  });
});
