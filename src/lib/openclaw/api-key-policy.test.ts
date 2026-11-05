import { describe, expect, it } from "vitest";
import {
  DASHSCOPE_API_KEY_ID,
  DEEPSEEK_API_KEY_ID,
  hasRequiredModelProviderKey,
  isApiKeyMissingConnectError,
  MIMO_API_KEY_ID,
} from "./api-key-policy";

describe("api-key-policy", () => {
  it("accepts any one of three vendor keys", () => {
    const keys = [
      { id: DEEPSEEK_API_KEY_ID, label: "", hint: "", configured: false, required: false },
    ];
    expect(hasRequiredModelProviderKey(keys, {})).toBe(false);
    expect(
      hasRequiredModelProviderKey(keys, { [DEEPSEEK_API_KEY_ID]: "sk-deepseek" }),
    ).toBe(true);
    expect(
      hasRequiredModelProviderKey(keys, { [MIMO_API_KEY_ID]: "sk-mimo" }),
    ).toBe(true);
    expect(
      hasRequiredModelProviderKey(keys, { [DASHSCOPE_API_KEY_ID]: "sk-qwen" }),
    ).toBe(true);
  });

  it("accepts configured dashscope from env status without form values", () => {
    const keys = [
      { id: DASHSCOPE_API_KEY_ID, label: "", hint: "", configured: true, required: false },
    ];
    expect(hasRequiredModelProviderKey(keys, {})).toBe(true);
  });

  it("detects missing vendor key messages", () => {
    expect(isApiKeyMissingConnectError("MIMO_API_KEY missing or empty")).toBe(true);
    expect(isApiKeyMissingConnectError("DEEPSEEK_API_KEY missing or empty")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isApiKeyMissingConnectError("connection refused")).toBe(false);
    expect(isApiKeyMissingConnectError(null)).toBe(false);
  });
});
