import catalog from "./community-skill-catalog.json";
import bundledManifest from "./community-skill-bundled.json";
import delistConfig from "./community-skill-delist.json";

export type CommunitySkillEntry = {
  dirName: string;
  name: string;
  description: string;
  category: string;
};

export type CommunitySkillCategory = {
  id: string;
  label: string;
  skills: CommunitySkillEntry[];
};

export type CommunitySkillCatalog = {
  packId: string;
  packLabel: string;
  version: number;
  skillCount: number;
  categories: CommunitySkillCategory[];
  skills: CommunitySkillEntry[];
};

export type CommunitySkillBundledManifest = {
  generatedAt: string;
  bundledCount: number;
  catalogCount: number;
  dirNames: string[];
  missingFromBundle: string[];
};

export const COMMUNITY_SKILL_CATALOG = catalog as CommunitySkillCatalog;
export const COMMUNITY_SKILL_BUNDLED = bundledManifest as CommunitySkillBundledManifest;

const DELISTED_CATEGORIES = new Set<string>(delistConfig.categories ?? []);
const DELISTED_DIRS = new Set<string>(delistConfig.dirNames ?? []);

/** 展开分类 + 显式目录，得到完整下架集合。 */
export function resolveDelistedDirNames(): Set<string> {
  const out = new Set(DELISTED_DIRS);
  for (const skill of COMMUNITY_SKILL_CATALOG.skills) {
    if (DELISTED_CATEGORIES.has(skill.category)) {
      out.add(skill.dirName);
    }
  }
  return out;
}

const DELISTED_SET = resolveDelistedDirNames();

/** 技能是否在技能工坊展示/可安装（下架技能返回 false）。 */
export function isCommunitySkillListed(dirName: string): boolean {
  return !DELISTED_SET.has(dirName);
}

export function isCommunitySkillDelisted(dirName: string): boolean {
  return DELISTED_SET.has(dirName);
}

const BUNDLED_SET = new Set(
  COMMUNITY_SKILL_BUNDLED.dirNames.filter((d) => isCommunitySkillListed(d)),
);

/** 安装包内是否带有该技能的 SKILL.md 文件（可一键安装）。 */
export function isCommunitySkillInstallable(dirName: string): boolean {
  return isCommunitySkillListed(dirName) && BUNDLED_SET.has(dirName);
}

/** 技能工坊展示的全部社区技能（不含下架项）。 */
export function listAllCommunitySkills(): CommunitySkillEntry[] {
  return COMMUNITY_SKILL_CATALOG.skills.filter((s) => isCommunitySkillListed(s.dirName));
}

/** 安装包中实际存在且未下架的社区技能。 */
export function listInstallableCommunitySkills(): CommunitySkillEntry[] {
  if (BUNDLED_SET.size === 0) {
    return [];
  }
  return listAllCommunitySkills().filter((s) => BUNDLED_SET.has(s.dirName));
}

export function listInstallableCommunityCategories(): CommunitySkillCategory[] {
  const installable = new Set(listInstallableCommunitySkills().map((s) => s.dirName));
  return listCommunitySkillCategories()
    .map((cat) => ({
      ...cat,
      skills: cat.skills.filter((s) => installable.has(s.dirName)),
    }))
    .filter((cat) => cat.skills.length > 0);
}

export function communityBundleStats(): {
  bundledCount: number;
  catalogCount: number;
  installableCount: number;
  missingCount: number;
  delistedCount: number;
} {
  const listed = listAllCommunitySkills();
  const installable = listInstallableCommunitySkills();
  return {
    bundledCount: BUNDLED_SET.size,
    catalogCount: listed.length,
    installableCount: installable.length,
    missingCount: COMMUNITY_SKILL_BUNDLED.missingFromBundle?.length ?? 0,
    delistedCount: DELISTED_SET.size,
  };
}

/** 全部分类（展示用，已排除下架技能与空分类）。 */
export function listCommunitySkillCategories(): CommunitySkillCategory[] {
  return COMMUNITY_SKILL_CATALOG.categories
    .map((cat) => ({
      ...cat,
      skills: cat.skills.filter((s) => isCommunitySkillListed(s.dirName)),
    }))
    .filter((cat) => cat.skills.length > 0);
}

export function findCommunitySkill(dirName: string): CommunitySkillEntry | undefined {
  const skill = COMMUNITY_SKILL_CATALOG.skills.find((s) => s.dirName === dirName);
  if (!skill || !isCommunitySkillListed(dirName)) return undefined;
  return skill;
}
