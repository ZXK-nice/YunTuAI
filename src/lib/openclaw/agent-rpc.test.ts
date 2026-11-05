import { describe, expect, it } from "vitest";
import {
  buildAgentCreateRpcParams,
  buildAgentDeleteRpcParams,
  buildGatewayAgentCreateName,
  formatAgentModelLabel,
  isAgentDeletable,
  normalizeAgentIdFromName,
  parseAgentCreateResult,
  parseAgentList,
  parseAgentModelField,
  qualifyAgentModelId,
} from "./agent-rpc";

describe("buildAgentDeleteRpcParams", () => {
  it("only sends agentId (gateway rejects root id)", () => {
    expect(buildAgentDeleteRpcParams("11-11")).toEqual({ agentId: "11-11" });
    expect(buildAgentDeleteRpcParams("  sales-bot  ")).toEqual({ agentId: "sales-bot" });
  });
});

describe("isAgentDeletable", () => {
  it("blocks default and main agents", () => {
    expect(isAgentDeletable({ id: "main", isDefault: true })).toBe(false);
    expect(isAgentDeletable({ id: "main", isDefault: false })).toBe(false);
    expect(isAgentDeletable({ id: "sales-bot", isDefault: true })).toBe(false);
  });

  it("allows non-default custom agents", () => {
    expect(isAgentDeletable({ id: "11-11", isDefault: false })).toBe(true);
  });
});

describe("normalizeAgentIdFromName", () => {
  it("maps ascii names to slug", () => {
    expect(normalizeAgentIdFromName("Sales Bot")).toBe("sales-bot");
  });

  it("returns main for pure chinese (gateway reserved)", () => {
    expect(normalizeAgentIdFromName("智能助手")).toBe("main");
  });
});

describe("buildGatewayAgentCreateName", () => {
  it("prefixes slug for chinese display names", () => {
    const name = buildGatewayAgentCreateName("智能助手", "sales-bot");
    expect(name.startsWith("sales-bot")).toBe(true);
    expect(name).toContain("智能助手");
  });
});

describe("buildAgentCreateRpcParams", () => {
  it("includes required workspace path", () => {
    const params = buildAgentCreateRpcParams(
      {
        displayName: "智能助手",
        preferredId: "sales-bot",
        model: "deepseek-v4-flash",
        openclawDataDir: "C:\\YunTuAI\\openclaw-data",
      },
      "deepseek/deepseek-v4-flash",
    );
    expect(params.workspace).toBe("C:\\YunTuAI\\openclaw-data\\workspace-sales-bot");
    expect(params.model).toBe("deepseek/deepseek-v4-flash");
    expect(typeof params.name).toBe("string");
  });
});

describe("parseAgentCreateResult", () => {
  it("parses ok payload from agents.create", () => {
    const agent = parseAgentCreateResult({
      ok: true,
      agentId: "sales-bot",
      name: "sales-bot 智能助手",
      model: "deepseek/deepseek-v4-flash",
      workspace: "C:\\data\\workspace-sales-bot",
    });
    expect(agent?.id).toBe("sales-bot");
    expect(agent?.name).toBe("sales-bot 智能助手");
  });
});

describe("qualifyAgentModelId", () => {
  it("adds provider prefix from default", () => {
    expect(qualifyAgentModelId("deepseek-v4-flash", "deepseek/deepseek-v4-flash")).toBe(
      "deepseek/deepseek-v4-flash",
    );
  });
});

describe("parseAgentModelField", () => {  it("reads string model", () => {
    expect(parseAgentModelField("deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("reads object model.primary", () => {
    expect(parseAgentModelField({ primary: "deepseek/deepseek-v4-flash" })).toBe(
      "deepseek/deepseek-v4-flash",
    );
  });
});

describe("parseAgentList", () => {
  it("parses model object on agents.list rows", () => {
    const result = parseAgentList({
      agents: [{ id: "main", name: "main", model: { primary: "deepseek/deepseek-v4-flash" } }],
    });
    expect(result.agents[0]?.model).toBe("deepseek/deepseek-v4-flash");
  });
});

describe("formatAgentModelLabel", () => {
  it("shortens provider/model id", () => {
    expect(formatAgentModelLabel("deepseek/deepseek-v4-flash")).toBe("deepseek v4 flash");
  });
});
