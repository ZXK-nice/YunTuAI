import { describe, expect, it } from "vitest";
import {
  enrichMcpsWithTools,
  groupMcpToolsByServer,
  isOpenClawNativeSkill,
  isUserInstalledGatewaySkill,
  mergeGatewaySkillsWithAgentNames,
  partitionGatewaySkills,
  type GatewaySkillInfo,
  type GatewayToolInfo,
} from "./gateway-tools";

describe("gateway-tools skill partition", () => {
  it("detects workspace skills as user-installed", () => {
    const skill: GatewaySkillInfo = {
      name: "demo",
      filePath: "C:/data/workspace/.agents/skills/demo/SKILL.md",
    };
    expect(isUserInstalledGatewaySkill(skill)).toBe(true);
    expect(isOpenClawNativeSkill(skill)).toBe(false);
  });

  it("treats bundled source as native", () => {
    const skill: GatewaySkillInfo = {
      name: "browser",
      source: "openclaw-bundled",
    };
    expect(isUserInstalledGatewaySkill(skill)).toBe(false);
    expect(isOpenClawNativeSkill(skill)).toBe(true);
  });

  it("partitions native vs user skills", () => {
    const parts = partitionGatewaySkills([
      { name: "native-a", source: "openclaw-bundled" },
      { name: "user-a", filePath: "/workspace/.agents/skills/user-a/SKILL.md" },
    ]);
    expect(parts.native.map((s) => s.name)).toEqual(["native-a"]);
    expect(parts.userInstalled.map((s) => s.name)).toEqual(["user-a"]);
  });

  it("merges agent skill names without agent description bleed", () => {
    const merged = mergeGatewaySkillsWithAgentNames(
      [{ name: "wps-office", description: "办公技能" }],
      ["extra-skill"],
    );
    expect(merged.map((s) => s.name).sort()).toEqual(["extra-skill", "wps-office"]);
    expect(merged.find((s) => s.name === "extra-skill")?.description).toBeUndefined();
  });
});

describe("gateway-tools mcp grouping", () => {
  it("groups mcp tools by server prefix", () => {
    const tools: GatewayToolInfo[] = [
      { name: "filesystem.read", origin: "mcp" },
      { name: "filesystem.write", origin: "mcp" },
      { name: "exec.run", origin: "mcp-server" },
    ];
    const grouped = groupMcpToolsByServer(tools);
    expect(grouped.get("filesystem")?.length).toBe(2);
    expect(grouped.get("exec")?.length).toBe(1);
  });

  it("enriches mcp rows with live tool list", () => {
    const tools: GatewayToolInfo[] = [{ name: "demo.ping", origin: "mcp", description: "ping" }];
    const enriched = enrichMcpsWithTools([{ name: "demo", enabled: true }], tools);
    expect(enriched[0]?.toolCount).toBe(1);
    expect(enriched[0]?.tools[0]?.name).toBe("demo.ping");
  });
});
