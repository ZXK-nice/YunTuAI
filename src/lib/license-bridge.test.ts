import { describe, expect, it } from "vitest";
import {
  formatLicenseExpiryLabel,
  humanizeLicenseActivateError,
  isConnectSlowHint,
  isValidLicenseFingerprint,
  normalizeLicensePaste,
} from "./license-bridge";

describe("license-bridge", () => {
  describe("isValidLicenseFingerprint", () => {
    it("accepts 64-char hex (case insensitive)", () => {
      const fp = "a".repeat(64);
      expect(isValidLicenseFingerprint(fp)).toBe(true);
      expect(isValidLicenseFingerprint(fp.toUpperCase())).toBe(true);
    });

    it("rejects wrong length or non-hex", () => {
      expect(isValidLicenseFingerprint("abc")).toBe(false);
      expect(isValidLicenseFingerprint("g".repeat(64))).toBe(false);
      expect(isValidLicenseFingerprint("")).toBe(false);
    });

    it("trims whitespace", () => {
      expect(isValidLicenseFingerprint(`  ${"b".repeat(64)}  `)).toBe(true);
    });
  });

  describe("formatLicenseExpiryLabel", () => {
    it("formats valid ISO date in zh-CN locale", () => {
      const label = formatLicenseExpiryLabel("2026-08-01T12:00:00.000Z");
      expect(label).toMatch(/2026/);
      expect(label.length).toBeGreaterThan(4);
    });

    it("returns empty for missing value", () => {
      expect(formatLicenseExpiryLabel(null)).toBe("");
      expect(formatLicenseExpiryLabel(undefined)).toBe("");
      expect(formatLicenseExpiryLabel("")).toBe("");
    });

    it("returns raw string when date is invalid", () => {
      expect(formatLicenseExpiryLabel("not-a-date")).toBe("not-a-date");
    });
  });

  describe("normalizeLicensePaste", () => {
    it("strips markdown code fence", () => {
      const json = '{"fingerprint":"ab","signature":"cd"}';
      expect(normalizeLicensePaste("```json\n" + json + "\n```")).toBe(json);
    });

    it("extracts JSON object from surrounding text", () => {
      const inner = '{"fingerprint":"x","signature":"y"}';
      expect(normalizeLicensePaste("file: license.dat\n" + inner + "\nend")).toBe(inner);
    });
  });

  describe("humanizeLicenseActivateError", () => {
    it("adds hint for fingerprint mismatch", () => {
      const out = humanizeLicenseActivateError("license 与当前设备不匹配");
      expect(out).toContain("机器指纹");
    });
  });

  describe("isConnectSlowHint", () => {
    it("detects unlock / slow connect copy", () => {
      expect(isConnectSlowHint("连接本机服务较慢。界面已解锁")).toBe(true);
      expect(isConnectSlowHint("网关崩溃")).toBe(false);
    });
  });
});
