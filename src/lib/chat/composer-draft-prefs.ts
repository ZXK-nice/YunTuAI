const DRAFTS_KEY = "yuntu.composerDrafts.v1";

/** 跨会话草稿条数上限，避免 localStorage 与内存长期膨胀 */
export const COMPOSER_DRAFT_MAX_KEYS = 24;

export function readComposerDrafts(): Record<string, string> {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string" && v.trim()) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 修剪草稿：丢弃已删会话的孤儿 key，并在超限时优先保留较短草稿。
 * @param validSessionIds 当前仍存在的会话 id；不含 `__new__`（始终单独保留）。
 */
export function trimComposerDrafts(
  drafts: Record<string, string>,
  validSessionIds?: ReadonlySet<string>,
): Record<string, string> {
  const nonempty: Record<string, string> = {};
  for (const [k, v] of Object.entries(drafts)) {
    const t = v.trim();
    if (!t) continue;
    if (k !== "__new__" && validSessionIds && !validSessionIds.has(k)) continue;
    nonempty[k] = t;
  }
  if (Object.keys(nonempty).length <= COMPOSER_DRAFT_MAX_KEYS) return nonempty;

  const result: Record<string, string> = {};
  if (nonempty["__new__"]) result["__new__"] = nonempty["__new__"];

  const rest = Object.keys(nonempty)
    .filter((k) => k !== "__new__")
    .sort((a, b) => {
      const la = nonempty[a];
      const lb = nonempty[b];
      return (la?.length ?? 0) - (lb?.length ?? 0);
    });

  let count = Object.keys(result).length;
  for (const k of rest) {
    if (count >= COMPOSER_DRAFT_MAX_KEYS) break;
    const text = nonempty[k];
    if (!text) continue;
    result[k] = text;
    count += 1;
  }
  return result;
}

export function persistComposerDrafts(drafts: Record<string, string>): void {
  try {
    const trimmed = trimComposerDrafts(drafts);
    if (Object.keys(trimmed).length === 0) {
      localStorage.removeItem(DRAFTS_KEY);
      return;
    }
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota */
  }
}

/** 启动或空闲时修剪 localStorage 草稿，并返回修剪后的快照。 */
export function runComposerDraftMaintenance(validSessionIds: string[]): Record<string, string> {
  const valid = new Set(validSessionIds);
  const current = readComposerDrafts();
  const trimmed = trimComposerDrafts(current, valid);
  if (Object.keys(trimmed).length !== Object.keys(current).length) {
    persistComposerDrafts(trimmed);
  }
  return trimmed;
}
