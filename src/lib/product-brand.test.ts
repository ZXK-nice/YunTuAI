import { describe, expect, it } from "vitest";
import { PRODUCT_CODE_NAME, PRODUCT_IDENTITY_LABEL, PRODUCT_NAME, PRODUCT_TAGLINE } from "./product-brand";

describe("product-brand", () => {
  it("exposes user-facing product name", () => {
    expect(PRODUCT_NAME).toBe("YunTu Control");
    expect(PRODUCT_TAGLINE).toContain("办事工作台");
  });

  it("keeps internal code name separate from display name", () => {
    expect(PRODUCT_CODE_NAME).toBe("YunTuAI");
    expect(PRODUCT_NAME).not.toBe(PRODUCT_CODE_NAME);
  });

  it("builds identity label from product name", () => {
    expect(PRODUCT_IDENTITY_LABEL).toBe("YunTu Control·会话约定");
  });
});
