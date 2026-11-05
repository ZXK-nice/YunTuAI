import { describe, expect, it } from "vitest";
import { sanitizeUserFacingCopy, SERVICE_PATH_LABELS } from "./product-copy";

describe("sanitizeUserFacingCopy", () => {
  it("replaces OpenClaw brand and technical path names", () => {
    const raw =
      "OpenClaw 运行时失败：请检查 openclaw-data/.env 与 openclaw-portable，并核对 openclaw.json";
    expect(sanitizeUserFacingCopy(raw)).toBe(
      `本机服务 运行时失败：请检查 ${SERVICE_PATH_LABELS.dataDir}/.env 与 ${SERVICE_PATH_LABELS.runtimeDir}，并核对 ${SERVICE_PATH_LABELS.configFile}`,
    );
  });

  it("leaves empty strings unchanged", () => {
    expect(sanitizeUserFacingCopy("")).toBe("");
  });

  it("replaces legacy home path and npm install wording", () => {
    expect(sanitizeUserFacingCopy("npm install openclaw 失败")).toBe("npm install 本机服务组件 失败");
    expect(sanitizeUserFacingCopy("OPENCLAW_GATEWAY_TOKEN 缺失")).toBe("服务令牌 缺失");
    expect(sanitizeUserFacingCopy("OPENCLAW_STATE_DIR 无效")).toBe("服务环境变量 无效");
    expect(sanitizeUserFacingCopy("小龙虾网关断开")).toBe("本机服务断开");
    expect(sanitizeUserFacingCopy("刷新网关订阅")).toBe("刷新本机服务订阅");
    expect(sanitizeUserFacingCopy("请检查 ~/.openclaw/openclaw.json")).toBe(
      `请检查 旧版用户目录/${SERVICE_PATH_LABELS.configFile}`,
    );
  });

  it("sanitizes gateway config schema errors", () => {
    const raw =
      'Gateway failed to start: Invalid config at D:\\yuntu\\openclaw-data\\openclaw.json. browser.profiles.user.color: Invalid input Run "openclaw doctor --fix"';
    const out = sanitizeUserFacingCopy(raw);
    expect(out.toLowerCase()).not.toContain("openclaw");
    expect(out).toContain("浏览器配置");
    expect(out).toContain("修复服务配置");
  });

  it("sanitizes Windows-style path segments", () => {
    const path = String.raw`C:\Users\me\AppData\Local\YunTuAI\openclaw-data\openclaw.json`;
    expect(sanitizeUserFacingCopy(path)).toBe(
      `C:\\Users\\me\\AppData\\Local\\YunTuAI\\${SERVICE_PATH_LABELS.dataDir}\\${SERVICE_PATH_LABELS.configFile}`,
    );
  });
});
