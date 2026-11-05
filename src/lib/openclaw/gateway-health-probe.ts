import { withTimeout } from "../async-utils";
import { cliGatewayHealthJson, type GatewayCliResult } from "./cli-bridge";

export const POST_RESTART_HEALTH_PROBE_MS = 3_000;

/** CLI 进程成功 ≠ 网关健康：必须看 health JSON / 文本是否真正 ok。 */
export function parseHealthLooksOk(health: GatewayCliResult | null): "ok" | "down" | "unknown" {
  if (!health?.ok || !health.stdout?.trim()) return "unknown";
  const raw = health.stdout.trim();
  try {
    const j: unknown = JSON.parse(raw);
    if (j && typeof j === "object") {
      const o = j as Record<string, unknown>;
      if (o.ok === true) return "ok";
      if (o.status === "ok" || o.healthy === true) return "ok";
    }
  } catch {
    /* 非 JSON 时，退化为子串 */
  }
  if (/error|fail|unavailable|refused|down|stopped/i.test(raw)) return "down";
  if (/ok|healthy|running|ready/i.test(raw)) return "ok";
  return "unknown";
}

export async function probeGatewayHealthLooksOk(): Promise<boolean> {
  const health = await withTimeout(
    cliGatewayHealthJson(),
    POST_RESTART_HEALTH_PROBE_MS,
    "gateway_health_probe",
  ).catch(() => null);
  return parseHealthLooksOk(health) === "ok";
}
