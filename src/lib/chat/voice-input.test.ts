import { describe, expect, it } from "vitest";
import {
  describeSpeechRecognitionError,
  formatVoiceInputToast,
  isSpeechRecognitionSupported,
} from "./voice-input";

describe("voice-input", () => {
  it("detects speech API when constructors exist", () => {
    const prev = window.SpeechRecognition;
    (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition = class {} as never;
    expect(isSpeechRecognitionSupported()).toBe(true);
    window.SpeechRecognition = prev;
  });

  it("maps permission errors to actionable hints", () => {
    const out = describeSpeechRecognitionError("not-allowed");
    expect(out.message).toContain("未授权");
    expect(out.hint).toMatch(/麦克风/);
  });

  it("does not blame the local gateway for WebView speech network errors", () => {
    const out = describeSpeechRecognitionError("network");
    expect(out.message).toContain("在线听写");
    expect(out.hint).toMatch(/本机服务/);
  });

  it("formats toast with hint on second line", () => {
    const text = formatVoiceInputToast({
      ok: false,
      message: "麦克风权限被拒绝",
      hint: "去系统设置开启。",
    });
    expect(text).toContain("\n");
  });
});
