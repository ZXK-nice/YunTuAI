/**
 * 网关连接后 best-effort 记忆维护：修复 dreaming 产物、回填 dream diary。
 * 失败不阻断主流程。
 */

import { controlRequest, memoryDoctorRepair } from "./console-control";
import { getGatewayClient } from "./gateway-runtime";

export type MemoryMaintenanceReport = {
  repairAttempted: boolean;
  repairOk: boolean;
  backfillAttempted: boolean;
  backfillOk: boolean;
};

export async function runMemoryMaintenanceOnConnect(): Promise<MemoryMaintenanceReport> {
  const report: MemoryMaintenanceReport = {
    repairAttempted: false,
    repairOk: false,
    backfillAttempted: false,
    backfillOk: false,
  };

  const client = getGatewayClient();
  if (!client.isHelloOk) return report;

  report.repairAttempted = true;
  try {
    const res = await memoryDoctorRepair();
    report.repairOk = res.ok;
    if (!res.ok) {
      console.warn("[YunTuAI] memory doctor repair returned not ok", res);
    }
  } catch (err) {
    report.repairOk = false;
    console.warn("[YunTuAI] memory doctor repair failed", err);
  }

  report.backfillAttempted = true;
  try {
    const res = await controlRequest("doctor.memory.backfillDreamDiary", {}, {
      timeoutMs: 120_000,
      singleFlight: true,
    });
    report.backfillOk = res.ok;
    if (!res.ok) {
      console.warn("[YunTuAI] dream diary backfill returned not ok", res);
    }
  } catch (err) {
    report.backfillOk = false;
    console.warn("[YunTuAI] dream diary backfill failed", err);
  }

  return report;
}
