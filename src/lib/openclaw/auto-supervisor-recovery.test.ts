import { beforeEach, describe, expect, it, vi } from "vitest";

const statusMock = vi.fn();
const recoveryMock = vi.fn();
const healthMock = vi.fn();

vi.mock("./connection-resilience", () => ({
  isSupervisorGatewayOperational: (st: { running?: boolean } | null) =>
    Boolean(st?.running),
}));

vi.mock("./cli-bridge", () => ({
  cliGatewaySupervisorStatus: (...args: unknown[]) => statusMock(...args),
}));

vi.mock("./gateway-lifecycle", () => ({
  requestGatewaySupervisorRecovery: (...args: unknown[]) => recoveryMock(...args),
}));

vi.mock("./gateway-health-probe", () => ({
  probeGatewayHealthLooksOk: (...args: unknown[]) => healthMock(...args),
}));

import {
  __resetAutoRecoverForTest,
  autoRecoverSupervisorGateway,
} from "./auto-supervisor-recovery";

describe("autoRecoverSupervisorGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAutoRecoverForTest();
    recoveryMock.mockResolvedValue(null);
    healthMock.mockResolvedValue(true);
  });

  it("returns true when supervisor and health already ok", async () => {
    statusMock.mockResolvedValue({ running: true });
    await expect(autoRecoverSupervisorGateway()).resolves.toBe(true);
    expect(recoveryMock).not.toHaveBeenCalled();
  });

  it("recovers when process is up but health fails", async () => {
    statusMock.mockResolvedValue({ running: true });
    healthMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(autoRecoverSupervisorGateway()).resolves.toBe(true);
    expect(recoveryMock).toHaveBeenCalledTimes(1);
  });

  it("requests recovery when supervisor is down", async () => {
    statusMock
      .mockResolvedValueOnce({ running: false })
      .mockResolvedValueOnce({ running: true });
    await expect(autoRecoverSupervisorGateway()).resolves.toBe(true);
    expect(recoveryMock).toHaveBeenCalledTimes(1);
  });

  it("returns false when recovery does not restore health", async () => {
    statusMock.mockResolvedValue({ running: false });
    healthMock.mockResolvedValue(false);
    await expect(autoRecoverSupervisorGateway()).resolves.toBe(false);
    expect(recoveryMock).toHaveBeenCalledTimes(1);
  });

  it("force=true restarts even when already healthy", async () => {
    statusMock.mockResolvedValue({ running: true });
    await expect(autoRecoverSupervisorGateway({ force: true })).resolves.toBe(true);
    expect(recoveryMock).toHaveBeenCalledTimes(1);
  });
});
