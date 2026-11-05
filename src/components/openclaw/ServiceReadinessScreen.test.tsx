import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceReadinessScreen } from "./ServiceReadinessScreen";

vi.mock("../../hooks/useAppLogo", () => ({
  useAppLogo: () => "/logo.png",
}));

vi.mock("../../hooks/useServiceReadinessProgress", () => ({
  useServiceReadinessProgress: () => ({
    combinedPercent: 42,
    detail: "正在连接…",
    lifecycle: { phase: "starting" },
    provision: null,
    phaseLabel: "启动本机服务",
  }),
}));

describe("ServiceReadinessScreen", () => {
  it("provision 模式展示阶段与进度", () => {
    render(
      <ServiceReadinessScreen
        mode="provision"
        snapshot={{
          phase: "extract",
          percent: 55,
          message: "正在解压…",
          running: true,
          needed: true,
          ready: false,
          error: null,
          choiceRequired: false,
          globalAvailable: false,
          bundledReady: true,
          bundledInstallAvailable: true,
          bundledVersion: "test",
        }}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("正在准备云图")).toBeInTheDocument();
    expect(screen.getByText("正在准备（2/5）")).toBeInTheDocument();
    expect(screen.getByText("正在解压…")).toBeInTheDocument();
  });

  it("connect 模式展示连接文案", () => {
    render(
      <ServiceReadinessScreen
        mode="connect"
        label="正在连接本机服务…"
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText("正在准备云图")).toBeInTheDocument();
  });
});
