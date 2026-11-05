import { describe, expect, it } from "vitest";
import { connStatusDotClass, latencyToQuality, qualityDotClass, qualityLabel } from "./connection-quality";

describe("latencyToQuality", () => {
  it("classifies latency bands", () => {
    expect(latencyToQuality(null)).toBe("unknown");
    expect(latencyToQuality(undefined)).toBe("unknown");
    expect(latencyToQuality(100)).toBe("good");
    expect(latencyToQuality(249)).toBe("good");
    expect(latencyToQuality(250)).toBe("fair");
    expect(latencyToQuality(899)).toBe("fair");
    expect(latencyToQuality(900)).toBe("poor");
    expect(latencyToQuality(5000)).toBe("poor");
  });
});

describe("qualityLabel", () => {
  it("returns zh labels", () => {
    expect(qualityLabel("good")).toBe("连接良好");
    expect(qualityLabel("fair")).toBe("连接一般");
    expect(qualityLabel("poor")).toBe("连接较慢");
    expect(qualityLabel("unknown")).toBe("测量中");
  });
});

describe("qualityDotClass", () => {
  it("returns css classes for each quality", () => {
    expect(qualityDotClass("good")).toContain("--good");
    expect(qualityDotClass("fair")).toContain("--fair");
    expect(qualityDotClass("poor")).toContain("--poor");
    expect(qualityDotClass("unknown")).toContain("--muted");
  });
});

describe("connStatusDotClass", () => {
  it("maps connection state to status dot classes", () => {
    expect(connStatusDotClass("connected", true)).toContain("--good");
    expect(connStatusDotClass("connecting", false)).toContain("--fair");
    expect(connStatusDotClass("error", false)).toContain("--poor");
    expect(connStatusDotClass("disconnected", false)).toContain("--poor");
  });
});
