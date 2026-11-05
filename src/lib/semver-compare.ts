/** 解析 x.y.z 前缀数字，用于版本比较（与 Rust updater 逻辑一致）。 */
export function parseVersionParts(version: string): [number, number, number, number] {
  const parts: [number, number, number, number] = [0, 0, 0, 0];
  version.split(".").slice(0, 4).forEach((segment, index) => {
    const digits = segment.match(/^\d+/)?.[0] ?? "0";
    parts[index] = Number.parseInt(digits, 10) || 0;
  });
  return parts;
}

export function isVersionNewer(latest: string, current: string): boolean {
  const a = parseVersionParts(latest);
  const b = parseVersionParts(current);
  for (let i = 0; i < 4; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}
