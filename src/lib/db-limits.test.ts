import { describe, expect, it } from "vitest";
import { getUtf8ByteLength, isWithinLocalMessageLimit, MAX_LOCAL_MESSAGE_UTF8_BYTES } from "./db-limits";

describe("db-limits", () => {
  it("ascii length matches byte length", () => {
    expect(getUtf8ByteLength("abc")).toBe(3);
  });

  it("CJK uses more than one byte per code point", () => {
    expect(getUtf8ByteLength("中文")).toBeGreaterThan(2);
  });

  it("isWithinLocalMessageLimit matches byte comparison with TextEncoder", () => {
    const s = "hello";
    expect(isWithinLocalMessageLimit(s)).toBe(getUtf8ByteLength(s) <= MAX_LOCAL_MESSAGE_UTF8_BYTES);
  });
});
