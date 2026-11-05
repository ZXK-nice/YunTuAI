/** 侧栏排序/展示用的会话活动时间（优先最后一条消息，而非元数据同步时间）。 */
export type SessionActivityRow = {
  id?: string;
  updatedAt: string;
  createdAt: string;
  lastMessageAt?: string | null;
};

export function sessionActivityAt(row: SessionActivityRow): string {
  const last = row.lastMessageAt?.trim();
  if (last) return last;
  return row.updatedAt;
}

export function compareSessionsByActivity(
  a: SessionActivityRow,
  b: SessionActivityRow,
): number {
  const aAt = Number(sessionActivityAt(a));
  const bAt = Number(sessionActivityAt(b));
  const aValid = Number.isFinite(aAt);
  const bValid = Number.isFinite(bAt);
  if (aValid && bValid && aAt !== bAt) return bAt - aAt;
  if (aValid !== bValid) return aValid ? -1 : 1;

  const createdDelta = Number(b.createdAt) - Number(a.createdAt);
  if (Number.isFinite(createdDelta) && createdDelta !== 0) return createdDelta;

  if (a.id && b.id && a.id !== b.id) return b.id.localeCompare(a.id);
  return 0;
}

export function sortSessionsByActivity<T extends SessionActivityRow>(rows: T[]): T[] {
  return [...rows].sort(compareSessionsByActivity);
}
