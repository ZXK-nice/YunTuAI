import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetIncompleteTurnContinueForTests,
  scheduleIncompleteTurnContinue,
  shouldScheduleIncompleteTurnContinue,
} from "./incomplete-turn-continue";

describe("incomplete-turn-continue", () => {
  beforeEach(() => {
    resetIncompleteTurnContinueForTests();
    localStorage.removeItem("yuntu-auto-continue-incomplete-v1");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem("yuntu-auto-continue-incomplete-v1");
  });

  it("detects planning-only replies as incomplete", () => {
    expect(shouldScheduleIncompleteTurnContinue("让我批量搜索深圳软件类 AI 公司。")).toBe(true);
    expect(shouldScheduleIncompleteTurnContinue("**✅ 清单已写入桌面**\n路径：…")).toBe(false);
  });

  it("does not auto-continue empty or ordinary undelivered text", () => {
    expect(shouldScheduleIncompleteTurnContinue("")).toBe(false);
    expect(shouldScheduleIncompleteTurnContinue("   ")).toBe(false);
    expect(
      shouldScheduleIncompleteTurnContinue("深圳有 12 家软件公司，名单如下：甲、乙、丙。"),
    ).toBe(false);
  });

  it("detects tool cutoff and incomplete markers", () => {
    expect(shouldScheduleIncompleteTurnContinue("工具链被截断，尚未写入文件。")).toBe(true);
    expect(shouldScheduleIncompleteTurnContinue("stopReason: toolUse")).toBe(true);
    expect(shouldScheduleIncompleteTurnContinue("【未完成】还差导出表格")).toBe(true);
    expect(shouldScheduleIncompleteTurnContinue("【生成已中断】")).toBe(true);
  });

  it("auto-continues interrupted turns up to five times", async () => {
    const sendContinue = vi.fn(async () => undefined);
    const deps = {
      isSending: () => false,
      isConnected: () => true,
      showToast: vi.fn(),
      sendContinue,
    };
    const interrupted = "长任务进行中【生成已中断，以上为已输出内容。发送「继续」可从断点续写。】";

    for (let i = 0; i < 5; i += 1) {
      scheduleIncompleteTurnContinue("s1", `send-${i}`, interrupted, deps);
      await vi.advanceTimersByTimeAsync(1500);
    }
    expect(sendContinue).toHaveBeenCalledTimes(5);
    expect(sendContinue).toHaveBeenCalledWith("继续", 1);

    scheduleIncompleteTurnContinue("s1", "send-6", interrupted, deps);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendContinue).toHaveBeenCalledTimes(5);
  });

  it("auto-continues at most twice for planning-only replies", async () => {
    const sendContinue = vi.fn(async () => undefined);
    const deps = {
      isSending: () => false,
      isConnected: () => true,
      showToast: vi.fn(),
      sendContinue,
    };

    scheduleIncompleteTurnContinue("s1", "send-1", "让我继续搜索并写入清单", deps);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendContinue).toHaveBeenCalledTimes(1);
    expect(deps.showToast).toHaveBeenCalledWith("已自动续跑 1/2", "info");

    scheduleIncompleteTurnContinue("s1", "send-2", "让我继续整理结果", deps);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendContinue).toHaveBeenCalledTimes(2);

    scheduleIncompleteTurnContinue("s1", "send-3", "让我继续写入报告", deps);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendContinue).toHaveBeenCalledTimes(2);
  });

  it("skips scheduling when auto-continue pref is off", async () => {
    localStorage.setItem("yuntu-auto-continue-incomplete-v1", "0");
    const sendContinue = vi.fn(async () => undefined);
    scheduleIncompleteTurnContinue("s1", "send-1", "让我继续搜索并写入清单", {
      isSending: () => false,
      isConnected: () => true,
      showToast: vi.fn(),
      sendContinue,
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendContinue).not.toHaveBeenCalled();
    localStorage.removeItem("yuntu-auto-continue-incomplete-v1");
  });
});
