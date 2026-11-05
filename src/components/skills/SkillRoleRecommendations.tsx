import { memo, useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import {
  getRoleSkillRecommendations,
  defaultSelectedRecommendationDirs,
  type RoleSkillRecommendation,
} from "../../lib/skills/skill-role-recommendations";
import { isCommunitySkillInstallable } from "../../lib/skills/community-skill-catalog";
import { StudioBadge, StudioSection } from "./skill-studio-ui";

type Props = {
  industryId: string;
  roleId: string;
  installedDirs: Set<string>;
  selectedDirs: Set<string>;
  onSelectedChange: Dispatch<SetStateAction<Set<string>>>;
};

function RecommendationCard({
  item,
  checked,
  installed,
  installable,
  onToggle,
}: {
  item: RoleSkillRecommendation;
  checked: boolean;
  installed: boolean;
  installable: boolean;
  onToggle: () => void;
}) {
  const disabled = installed || !installable;
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-[var(--radius-md)] border p-3 transition-colors ${
        checked && !disabled
          ? "border-[var(--brand-color)]/40 bg-[var(--brand-tint-8)]"
          : "border-[var(--border-subtle)] bg-[var(--surface-2)]/30"
      } ${disabled ? "cursor-default opacity-70" : "hover:border-[var(--border-strong)]"}`}
    >
      <input
        type="checkbox"
        className="mt-0.5 shrink-0 accent-[var(--brand-color)]"
        checked={installed || checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-primary)]">{item.label}</span>
          <code className="font-mono text-[10px] text-[var(--text-tertiary)]">{item.dirName}</code>
          {installed && (
            <StudioBadge>已安装</StudioBadge>
          )}
          {!installable && !installed && (
            <StudioBadge>需完整安装包</StudioBadge>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{item.desc}</p>
        {item.bundleHint && (
          <p className="mt-1 text-[10px] text-[var(--brand-color)]">{item.bundleHint}</p>
        )}
      </div>
    </label>
  );
}

export const SkillRoleRecommendations = memo(function SkillRoleRecommendations({
  industryId,
  roleId,
  installedDirs,
  selectedDirs,
  onSelectedChange,
}: Props) {
  const recommendations = useMemo(
    () => getRoleSkillRecommendations(industryId, roleId),
    [industryId, roleId],
  );

  const roleKey = `${industryId}/${roleId}`;
  const prevRoleKey = useRef("");

  useEffect(() => {
    if (roleKey === prevRoleKey.current) return;
    prevRoleKey.current = roleKey;
    const defaults = defaultSelectedRecommendationDirs(industryId, roleId).filter(
      (d) => !installedDirs.has(d),
    );
    onSelectedChange(new Set(defaults));
  }, [roleKey, industryId, roleId, installedDirs, onSelectedChange]);

  const toggle = useCallback(
    (dirName: string) => {
      onSelectedChange(
        (() => {
          const next = new Set(selectedDirs);
          if (next.has(dirName)) next.delete(dirName);
          else next.add(dirName);
          return next;
        })(),
      );
    },
    [onSelectedChange, selectedDirs],
  );

  if (recommendations.length === 0) return null;

  return (
    <StudioSection
      title="推荐技能"
      subtitle="根据岗位推荐可一键安装的社区技能；安装后自动启用并刷新本机服务"
    >
      <div className="grid gap-2">
        {recommendations.map((item) => (
          <RecommendationCard
            key={item.dirName}
            item={item}
            checked={selectedDirs.has(item.dirName)}
            installed={installedDirs.has(item.dirName)}
            installable={isCommunitySkillInstallable(item.dirName)}
            onToggle={() => toggle(item.dirName)}
          />
        ))}
      </div>
    </StudioSection>
  );
});
