import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_TIMEOUT_SECONDS,
  humanizeAgentRunTimeoutError,
  humanizeGatewayTimeoutError,
  humanizeModelIdleTimeoutError,
  isAgentRunTimeoutError,
  isModelIdleTimeoutError,
} from "./agent-run-timeout";

describe("agent-run-timeout", () => {
  it("detects gateway chat run timeout", () => {
    expect(isAgentRunTimeoutError("chat run timed out")).toBe(true);
    expect(
      isAgentRunTimeoutError(
        "Request timed out before a response was generated. Please try again, or increase `agents.defaults.timeoutSeconds` in your config.",
      ),
    ).toBe(true);
    expect(
      isAgentRunTimeoutError(
        "LLM request timed out. | The model did not produce a response before the model idle timeout.",
      ),
    ).toBe(true);
    expect(isAgentRunTimeoutError("connection reset")).toBe(false);
  });

  it("detects model idle timeout separately", () => {
    expect(
      isModelIdleTimeoutError("LLM request timed out. model idle timeout"),
    ).toBe(true);
    expect(isModelIdleTimeoutError("chat run timed out")).toBe(false);
  });

  it("humanizes model idle timeout in Chinese", () => {
    const msg = humanizeGatewayTimeoutError(
      "LLM request timed out. model idle timeout models.providers.deepseek.timeoutSeconds",
    );
    expect(msg).toContain("Excel");
    expect(humanizeModelIdleTimeoutError()).toContain("预提取");
  });

  it("humanize mentions configured hours", () => {
    const msg = humanizeAgentRunTimeoutError();
    expect(msg).toContain(String(AGENT_RUN_TIMEOUT_SECONDS / 3600));
    expect(msg).toContain("重试发送");
  });
});
