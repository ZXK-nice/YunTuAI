import { describe, expect, it } from "vitest";
import { t, setLocale } from "./index";

describe("i18n", () => {
  it("returns zh-CN by default", () => {
    expect(t("auth.login")).toBe("登录");
  });

  it("switches locale", () => {
    setLocale("en-US");
    expect(t("auth.login")).toBe("Sign in");
    setLocale("zh-CN");
  });
});
