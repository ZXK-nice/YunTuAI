import { describe, expect, it } from "vitest";
import {
  buildLocalMessageFingerprints,
  filterMissingGatewayRows,
  mapGatewayHistoryMessage,
  mapGatewayHistoryToRows,
  messageContentFingerprint,
} from "./session-history-backfill";

describe("mapGatewayHistoryMessage", () => {
  it("maps user text", () => {
    expect(mapGatewayHistoryMessage({ role: "user", content: "hello" })).toEqual({
      role: "user",
      content: "hello",
      gatewayId: undefined,
    });
  });

  it("maps assistant text", () => {
    expect(mapGatewayHistoryMessage({ role: "assistant", text: "hi there" })).toEqual({
      role: "assistant",
      content: "hi there",
      gatewayId: undefined,
    });
  });

  it("collapses multiple assistant rows in one turn when mapping history", () => {
    expect(
      mapGatewayHistoryToRows([
        { role: "user", content: "go" },
        { role: "assistant", text: "step 1" },
        { role: "assistant", text: "step 2" },
        { role: "assistant", text: "final" },
      ]),
    ).toEqual([{ role: "user", content: "go" }, { role: "assistant", content: "final", gatewayId: undefined }]);
  });

  it("maps assistant error", () => {
    expect(
      mapGatewayHistoryMessage({
        role: "assistant",
        stopReason: "error",
        errorMessage: "401 bad key",
      }),
    ).toEqual({
      role: "assistant",
      content: "[错误] 401 bad key",
      gatewayId: undefined,
    });
  });
});

describe("filterMissingGatewayRows", () => {
  it("skips rows already in local DB", () => {
    const local = [
      {
        id: "1",
        sessionId: "s",
        role: "user",
        content: "a",
        createdAt: "t",
      },
      {
        id: "2",
        sessionId: "s",
        role: "assistant",
        content: "b",
        createdAt: "t2",
      },
    ];
    const gateway = mapGatewayHistoryToRows([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "assistant", content: "c" },
    ]);
    const missing = filterMissingGatewayRows(gateway, local);
    expect(missing).toEqual([{ role: "assistant", content: "c", gatewayId: undefined }]);
  });

  it("skips gateway user rows that only add remote injection", () => {
    const local = [
      {
        id: "1",
        sessionId: "s",
        role: "user",
        content: "生成最新的 PDF",
        createdAt: "t",
      },
    ];
    const gateway = mapGatewayHistoryToRows([
      {
        role: "user",
        content: "生成最新的 PDF\n\n---\n【云图任务模式】请先拆解步骤",
      },
    ]);
    expect(filterMissingGatewayRows(gateway, local)).toEqual([]);
  });

  it("skips output-dir injection and hint-only user rows", () => {
    const local = [
      {
        id: "1",
        sessionId: "s",
        role: "user",
        content: "生成最新的 PDF",
        createdAt: "t",
      },
    ];
    const gateway = mapGatewayHistoryToRows([
      {
        role: "user",
        content:
          "生成最新的 PDF\n\n---\n【输出目录】所有最终产出文件必须保存到（勿写到其他目录）：\nD:\\out",
      },
      {
        role: "user",
        content: "【输出目录】所有最终产出文件必须保存到（勿写到其他目录）：\nD:\\out",
      },
    ]);
    expect(filterMissingGatewayRows(gateway, local)).toEqual([]);
  });

  it("fingerprints are role-sensitive", () => {
    const fp1 = messageContentFingerprint("user", "same");
    const fp2 = messageContentFingerprint("assistant", "same");
    expect(fp1).not.toBe(fp2);
    const set = buildLocalMessageFingerprints([
      { id: "1", sessionId: "s", role: "user", content: "same", createdAt: "t" },
    ]);
    expect(set.has(fp1)).toBe(true);
    expect(set.has(fp2)).toBe(false);
  });
});
