import { describe, expect, it } from "vitest";
import { checkBlockedPackageInstall } from "./exec-package-guard";

describe("checkBlockedPackageInstall", () => {
  it("blocks pip install", () => {
    const hit = checkBlockedPackageInstall("pip install pandas");
    expect(hit?.blocked).toBe(true);
    expect(hit?.reason).toContain("yuntu-office-write");
  });

  it("blocks npm install", () => {
    const hit = checkBlockedPackageInstall("npm install openpyxl");
    expect(hit?.blocked).toBe(true);
  });

  it("allows normal shell", () => {
    expect(checkBlockedPackageInstall("dir C:\\output")).toBeNull();
  });
});
