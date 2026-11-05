import { describe, expect, it } from "vitest";
import { validateLoginPassword } from "./auth-password-policy";

describe("auth-password-policy", () => {
  it("requires letter and digit min 8 for relay and internal", () => {
    expect(validateLoginPassword("abc12345", true)).toBeNull();
    expect(validateLoginPassword("abc12345", false)).toBeNull();
    expect(validateLoginPassword("12345678", true)).toBeTruthy();
    expect(validateLoginPassword("1234567", false)).toBeTruthy();
  });
});
