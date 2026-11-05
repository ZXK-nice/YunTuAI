import { describe, expect, it } from "vitest";
import {
  isFatalAssistantProbeError,
  isRecoverableAgentToolError,
  shouldAbortSendOnGatewayChatError,
  shouldPersistAssistantErrorBubble,
  humanizeAssistantRuntimeError,
} from "./runtime-error-policy";

describe("runtime-error-policy", () => {
  it("treats Edit failed as recoverable tool error", () => {
    const err = "[错误] ⚠️ 📝 Edit: in ~\\AppData\\output\\revised_manual.md failed";
    expect(isRecoverableAgentToolError(err)).toBe(true);
    expect(isFatalAssistantProbeError(err)).toBe(false);
    expect(shouldPersistAssistantErrorBubble(err, { sendStillActive: true })).toBe(false);
    expect(shouldAbortSendOnGatewayChatError(err)).toBe(false);
  });

  it("does not abort send on mid-tool failures", () => {
    expect(shouldAbortSendOnGatewayChatError("Write: notes.md failed")).toBe(false);
    expect(shouldAbortSendOnGatewayChatError("ENOENT: no such file or directory")).toBe(false);
  });

  it("does not abort send on transient network blips", () => {
    expect(shouldAbortSendOnGatewayChatError("ECONNRESET while reading")).toBe(false);
    expect(isFatalAssistantProbeError("fetch failed: network error")).toBe(false);
  });

  it("still aborts on fatal auth errors", () => {
    expect(shouldAbortSendOnGatewayChatError("Invalid API key")).toBe(true);
    expect(shouldAbortSendOnGatewayChatError("")).toBe(true);
    expect(shouldAbortSendOnGatewayChatError("", { hasDeliverableInTurn: true })).toBe(false);
  });

  it("treats compaction as fatal probe", () => {
    const err = "Auto-compaction could not recover this turn.";
    expect(isFatalAssistantProbeError(`[错误] ${err}`)).toBe(true);
  });

  it("names the rejected model instead of a generic runtime dump", () => {
    expect(humanizeAssistantRuntimeError("400 Unsupported model MiMo-V2.6-Pro")).toContain(
      "MiMo-V2.6-Pro",
    );
  });

  it("distinguishes insufficient balance from a missing reply", () => {
    expect(humanizeAssistantRuntimeError("402 Insufficient account balance")).toContain("余额不足");
    expect(humanizeAssistantRuntimeError("401 Authentication Fails")).toContain("API Key");
  });

  it("persists fatal errors to chat", () => {
    expect(shouldPersistAssistantErrorBubble("[错误] API key invalid", { sendStillActive: true })).toBe(
      true,
    );
  });

  it("aborts Message failed when the turn has no deliverable", () => {
    const err = "[错误] ⚠️ ✉️ Message failed";
    expect(shouldAbortSendOnGatewayChatError(err)).toBe(true);
    expect(shouldAbortSendOnGatewayChatError(err, { hasDeliverableInTurn: true })).toBe(false);
  });

  it("suppresses Message failed when deliverable already exists", () => {
    const err = "[错误] ⚠️ ✉️ Message failed";
    expect(shouldPersistAssistantErrorBubble(err, { hasDeliverableInTurn: true })).toBe(false);
    expect(shouldAbortSendOnGatewayChatError(err, { hasDeliverableInTurn: true })).toBe(false);
    expect(isFatalAssistantProbeError(err)).toBe(false);
  });

  it("humanizes raw OpenClaw dumps instead of showing them", () => {
    const out = humanizeAssistantRuntimeError(
      "OpenClaw runtime panic: TypeError at Object.<anonymous> (openclaw.mjs:12)",
    );
    expect(out.toLowerCase()).not.toContain("openclaw");
    expect(out).toMatch(/未能完成|本机服务/);
  });
});
