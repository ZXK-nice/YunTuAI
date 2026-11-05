/** 将 token 数格式化为模型选择器上的上下文标签（与百炼/网关配置对齐）。 */
export function formatContextLabel(tokens: number): string {
  if (tokens >= 1_048_576) return "1M";
  if (tokens >= 1_000_000) return "1M";
  if (tokens >= 256_000) return "256K";
  if (tokens >= 131_072) return "128K";
  if (tokens >= 65_536) return "64K";
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}
