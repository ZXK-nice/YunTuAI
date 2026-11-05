import { memo, useEffect, useMemo, useState } from "react";

import {
  inferSkillRuntimeTier,
  skillRuntimeTierLabel,
} from "../../lib/skills/skill-runtime-tier";
import {
  communityBundleStats,
  COMMUNITY_SKILL_CATALOG,
  isCommunitySkillInstallable,
  listAllCommunitySkills,
  listCommunitySkillCategories,
  type CommunitySkillEntry,
} from "../../lib/skills/community-skill-catalog";

type FilterKey = "all" | string;
const SKILL_PAGE_SIZE = 24;

function displaySkillTitle(skill: CommunitySkillEntry): string {
  if (skill.name !== skill.dirName) return skill.name;
  return skill.dirName
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" />
    </svg>
  );
}

const SkillCard = memo(function SkillCard({
  skill,
  showCategory,
  installing,
  installable,
  onInstall,
}: {
  skill: CommunitySkillEntry;
  showCategory: boolean;
  installing: boolean;
  installable: boolean;
  onInstall: (dirName: string) => void;
}) {
  const runtimeTier = inferSkillRuntimeTier(skill.dirName, skill.description);
  return (
    <article
      className={[
        "flex h-full flex-col justify-between gap-3 rounded-[var(--radius-md)] border p-3 transition-colors",
        installable
          ? "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 hover:border-[color-mix(in_oklab,var(--brand-color)_22%,var(--border-subtle))]"
          : "border-[var(--border-subtle)] bg-[var(--surface-2)]/30 opacity-90",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{displaySkillTitle(skill)}</h3>
          {showCategory && (
            <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
              {skill.category}
            </span>
          )}
          {!installable && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              未打入本安装包
            </span>
          )}
          {installable && runtimeTier === "needs-runtime" && (
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
              {skillRuntimeTierLabel(runtimeTier)}
            </span>
          )}
          {installable && runtimeTier === "bundled" && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              {skillRuntimeTierLabel(runtimeTier)}
            </span>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]" title={skill.description}>
          {skill.description}
        </p>
        <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">{skill.dirName}</p>
      </div>
      <button
        type="button"
        disabled={installing || !installable}
        title={installable ? undefined : "当前安装包未包含此技能文件，请使用完整发版包或联系管理员获取技能包"}
        onClick={() => onInstall(skill.dirName)}
        className={[
          "w-full rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50",
          installable ? "yt-btn-primary yt-transition" : "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)]",
        ].join(" ")}
      >
        {installing ? "安装中…" : installable ? "安装到工作区" : "暂不可安装"}
      </button>
    </article>
  );
});

export const CommunitySkillPackPanel = memo(function CommunitySkillPackPanel({
  onInstall,
  installingDir,
  compact = false,
}: {
  onInstall: (dirName: string) => void;
  installingDir: string | null;
  compact?: boolean;
}) {
  const categories = useMemo(() => listCommunitySkillCategories(), []);
  const bundleStats = useMemo(() => communityBundleStats(), []);
  const allSkills = useMemo(() => listAllCommunitySkills(), []);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [visibleCount, setVisibleCount] = useState(SKILL_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(SKILL_PAGE_SIZE);
  }, [query, filter]);

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: CommunitySkillEntry[] =
      filter === "all" ? [...allSkills] : (categories.find((c) => c.id === filter)?.skills ?? []);

    if (q) {
      list = allSkills.filter(
        (s) =>
          s.dirName.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      );
    } else if (filter === "all") {
      list.sort((a, b) => a.category.localeCompare(b.category, "zh-CN") || a.dirName.localeCompare(b.dirName));
    }

    return list;
  }, [allSkills, categories, filter, query]);

  const pagedSkills = useMemo(
    () => visibleSkills.slice(0, visibleCount),
    [visibleSkills, visibleCount],
  );
  const hasMoreSkills = visibleCount < visibleSkills.length;

  const showCategoryBadge = filter === "all" || query.trim().length > 0;

  const catalogSummary =
    bundleStats.installableCount > 0
      ? `目录 ${bundleStats.catalogCount} 个 · 本包可安装 ${bundleStats.installableCount} 个`
      : `目录 ${bundleStats.catalogCount} 个 · 本包暂无可安装项（可浏览，安装需完整技能包）`;

  return (
    <section className={compact ? "" : "mt-6"}>
      {!compact && (
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{COMMUNITY_SKILL_CATALOG.packLabel}</h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {catalogSummary} · {categories.length} 个分类
            </p>
          </div>
          <span className="mt-2 shrink-0 self-start rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[10px] font-medium tabular-nums text-[var(--text-secondary)] sm:mt-0">
            当前 {visibleSkills.length} 项
          </span>
        </div>
      )}

      {compact && (
        <p className="mb-3 text-xs text-[var(--text-secondary)]">
          {catalogSummary}，当前列表 {visibleSkills.length} 项
        </p>
      )}

      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索技能名、描述或分类…"
          className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[color-mix(in_oklab,var(--brand-color)_35%,var(--border-subtle))] focus:ring-2 focus:ring-[var(--brand-color)]/10"
        />
      </div>

      {!query.trim() && (
        <div
          className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="技能分类"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => setFilter("all")}
            className={[
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filter === "all"
                ? "bg-[var(--brand-color)] text-white"
                : "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            全部 {allSkills.length}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={filter === cat.id}
              onClick={() => setFilter(cat.id)}
              className={[
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                filter === cat.id
                  ? "bg-[var(--brand-color)] text-white"
                  : "border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              {cat.label} {cat.skills.length}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {visibleSkills.length === 0 ? (
          <div className="col-span-full rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] px-4 py-8 text-center text-sm text-[var(--text-tertiary)]">
            没有匹配的技能，试试换个关键词或分类
          </div>
        ) : (
          pagedSkills.map((skill) => (
            <SkillCard
              key={skill.dirName}
              skill={skill}
              showCategory={showCategoryBadge}
              installing={installingDir === skill.dirName}
              installable={isCommunitySkillInstallable(skill.dirName)}
              onInstall={onInstall}
            />
          ))
        )}
      </div>
      {hasMoreSkills ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((n) => n + SKILL_PAGE_SIZE)}
            className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          >
            加载更多（还剩 {visibleSkills.length - visibleCount} 项）
          </button>
        </div>
      ) : null}
    </section>
  );
});
