/**
 * 关键路径冒烟测试（4 条）：
 * 1. 发送参数 + localOnly 网关 patch
 * 2. 订阅发送前重试
 * 3. 断连发送收尾 + 可重试登记
 * 4. 网关恢复单飞 + 延迟重试
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionsSendParams } from "./session-rpc";
import { patchSessionLocalOnlyForSend } from "./local-only-policy";
import {
  ensureSessionsMessagesSubscribedForSend,
  invalidateSessionSubscription,
} from "./session-subscribe";
import {
  endGatewayRecovery,
  tryBeginGatewayRecovery,
  tryBeginGatewayRecoveryOrSchedule,
} from "./gateway-recovery-lock";
import { handleGatewaySendCatch } from "../../stores/session-send-retry";
import type { GatewayWsClient } from "./gateway-client";

vi.mock("./gateway-runtime", () => ({
  getGatewayClient: vi.fn(),
}));

describe("critical paths smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endGatewayRecovery();
  });

  it("path 1: builds sessions.send with yuntuai metadata and localOnly patch", async () => {
    const requestMock = vi.fn().mockResolvedValue({});
    const { getGatewayClient } = await import("./gateway-runtime");
    vi.mocked(getGatewayClient).mockReturnValue({
      isHelloOk: true,
      request: requestMock,
    } as unknown as ReturnType<typeof getGatewayClient>);

    const params = buildSessionsSendParams("agent:main:main", "hello", {
      timeoutMs: 120_000,
      idempotencyKey: "idem-1",
      localOnlyMode: true,
      toolDenylist: ["browser"],
      yuntuai: { sendId: "send-1" },
    });
    expect(params.key).toBe("agent:main:main");
    expect((params.metadata as Record<string, unknown>)?.yuntuaiLocalOnly).toBe(true);
    expect(((params.metadata as Record<string, unknown>)?.toolDenylist as string[]) ?? []).toContain(
      "browser",
    );

    await patchSessionLocalOnlyForSend("agent:main:main");
    expect(requestMock).toHaveBeenCalledWith(
      "sessions.patch",
      expect.objectContaining({ key: "agent:main:main" }),
      expect.any(Object),
    );
  });

  it("path 2: subscribe-for-send retries after weak subscription", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ eventsSubscribed: false, canonicalKey: "k1" })
      .mockResolvedValueOnce({ eventsSubscribed: true, canonicalKey: "k1" });
    const client = { isHelloOk: true, request } as unknown as GatewayWsClient;

    invalidateSessionSubscription("k1");
    const result = await ensureSessionsMessagesSubscribedForSend(client, "k1");
    expect(result.eventsSubscribed).toBe(true);
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("path 3: disconnect abort settles retryable send", async () => {
    const rememberRetryableSend = vi.fn();
    const settleDisconnect = vi.fn();
    const finalizeStepsOnSendError = vi.fn();
    const appendStoppedNotice = vi.fn().mockResolvedValue(undefined);
    const consumeFinishReason = vi.fn().mockReturnValue("disconnect" as const);

    await handleGatewaySendCatch({
      error: new Error("aborted"),
      signalAborted: true,
      capturedFinishReason: "disconnect",
      replyScanSinceMs: Date.now(),
      hooks: {
        guardLocalAppend: () => true,
        appendAssistantReply: vi.fn(),
        finalizeStepsOnSendError,
        rememberRetryableSend,
        clearRetryableSend: vi.fn(),
        clearPendingSendRecovery: vi.fn(),
        consumeGatewayAbortError: () => null,
        consumeFinishReason,
        settleDisconnect,
        appendStoppedNotice,
        maybeScheduleIdleTimeoutRetry: () => false,
        scheduleAutoRetry: vi.fn(),
      },
    });

    expect(settleDisconnect).toHaveBeenCalledWith({ showToast: false, setBanner: true });
    expect(finalizeStepsOnSendError).toHaveBeenCalled();
  });

  it("path 4: gateway recovery lock schedules retry when busy", () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    expect(tryBeginGatewayRecovery()).toBe(true);
    endGatewayRecovery();

    expect(tryBeginGatewayRecoveryOrSchedule(retry)).toBe(true);
    expect(tryBeginGatewayRecoveryOrSchedule(retry)).toBe(false);

    vi.advanceTimersByTime(3_000);
    expect(retry).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    endGatewayRecovery();
  });
});
