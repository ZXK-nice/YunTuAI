import { describe, expect, it } from "vitest";
import {
  collapseTurnAssistantMessages,
  findSupersededAssistantMessageIds,
} from "./collapse-turn-assistant-messages";

describe("collapseTurnAssistantMessages", () => {
  it("keeps a single assistant reply unchanged", () => {
    const rows = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "assistant", content: "hello" },
    ];
    expect(collapseTurnAssistantMessages(rows)).toEqual(rows);
  });

  it("collapses multiple assistant rows in the same turn to the last one", () => {
    const rows = [
      { id: "u1", role: "user", content: "crawl site" },
      { id: "a1", role: "assistant", content: "checking homepage" },
      { id: "a2", role: "assistant", content: "trying subpage" },
      { id: "a3", role: "assistant", content: "done summary" },
    ];
    expect(collapseTurnAssistantMessages(rows)).toEqual([
      { id: "u1", role: "user", content: "crawl site" },
      { id: "a3", role: "assistant", content: "done summary" },
    ]);
  });

  it("does not collapse assistant rows across different user turns", () => {
    const rows = [
      { id: "u1", role: "user", content: "a" },
      { id: "a1", role: "assistant", content: "b" },
      { id: "u2", role: "user", content: "c" },
      { id: "a2", role: "assistant", content: "d" },
      { id: "a3", role: "assistant", content: "e" },
    ];
    expect(collapseTurnAssistantMessages(rows)).toEqual([
      { id: "u1", role: "user", content: "a" },
      { id: "a1", role: "assistant", content: "b" },
      { id: "u2", role: "user", content: "c" },
      { id: "a3", role: "assistant", content: "e" },
    ]);
  });

  it("finds superseded assistant ids for db compaction", () => {
    const rows = [
      { id: "u1", role: "user", content: "a" },
      { id: "a1", role: "assistant", content: "step1" },
      { id: "a2", role: "assistant", content: "step2" },
      { id: "a3", role: "assistant", content: "final" },
    ];
    expect(findSupersededAssistantMessageIds(rows)).toEqual(["a1", "a2"]);
  });

  it("prefers deliverable chinese over trailing english reasoning wall", () => {
    const cn = "**✅ 已完成**\n\n讯飞摘星尽调报告已写入桌面。";
    const en = `Let me understand the user request. I need to search using tyc CLI.\n${"checking scripts. ".repeat(40)}`;
    const rows = [
      { id: "u1", role: "user", content: "report" },
      { id: "a1", role: "assistant", content: cn },
      { id: "a2", role: "assistant", content: en },
    ];
    expect(collapseTurnAssistantMessages(rows)).toEqual([
      { id: "u1", role: "user", content: "report" },
      { id: "a1", role: "assistant", content: cn },
    ]);
    expect(findSupersededAssistantMessageIds(rows)).toEqual(["a2"]);
  });
});
