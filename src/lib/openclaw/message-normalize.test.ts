import { describe, expect, it } from "vitest";
import {
  isInternalGatewayUserMessage,
  normalizeUserMessageForDedup,
  shouldSkipGatewayUserBackfill,
  userMessagesEquivalent,
} from "./message-normalize";

describe("normalizeUserMessageForDedup", () => {
  it("strips task planning hint suffix", () => {
    const raw = `生成最新的 PDF\n\n---\n【云图任务模式】请先在心里拆解`;
    expect(normalizeUserMessageForDedup(raw)).toBe("生成最新的 PDF");
  });

  it("strips output directory hint suffix", () => {
    const raw =
      "生成最新的 PDF\n\n---\n【输出目录】所有最终产出文件必须保存到（勿写到其他目录）：\nD:\\out";
    expect(normalizeUserMessageForDedup(raw)).toBe("生成最新的 PDF");
    expect(normalizeUserMessageForDedup(raw.split("\n\n---\n")[1] ?? "")).toBe("");
  });
  it("strips file context suffix", () => {
    const raw = `请整改手册\n\n---\n[文件上下文]\n用户附件位于 workspace/inbox/abc/`;
    expect(normalizeUserMessageForDedup(raw)).toBe("请整改手册");
  });

  it("strips identity hint prefix", () => {
    const raw =
      "[YunTu Control·会话约定]\n请以「YunTu Control」自称。\n——\n你好";
    expect(normalizeUserMessageForDedup(raw)).toBe("你好");
  });

  it("extracts trailing user text from session context bridge", () => {
    const raw = `【云图会话接续】
以下为本会话近期对话：

- 用户：继续

---

最好做全网深度调查`;
    expect(normalizeUserMessageForDedup(raw)).toBe("最好做全网深度调查");
  });
});

describe("userMessagesEquivalent", () => {
  it("matches local display with remote payload injection", () => {
    const local = "生成最新的 PDF";
    const remote = `${local}\n\n---\n【云图任务模式】请先拆解步骤`;
    expect(userMessagesEquivalent(local, remote)).toBe(true);
  });

  it("matches local short line with gateway context bridge wrapper", () => {
    const local = "继续";
    const remote = `【云图会话接续】\n摘要\n\n---\n\n继续`;
    expect(userMessagesEquivalent(local, remote)).toBe(true);
  });
});

describe("shouldSkipGatewayUserBackfill", () => {
  it("skips internal resume prompts", () => {
    expect(
      shouldSkipGatewayUserBackfill("Continue the OpenClaw runtime event.", []),
    ).toBe(true);
    expect(isInternalGatewayUserMessage("Continue the OpenClaw runtime event.")).toBe(true);
  });

  it("skips when local already has equivalent user line", () => {
    expect(
      shouldSkipGatewayUserBackfill("生成 PDF\n\n---\n【云图任务模式】", [
        { content: "生成 PDF" },
      ]),
    ).toBe(true);
  });
});
