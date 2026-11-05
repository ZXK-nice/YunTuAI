import { invokeAuthed } from "../tauri-invoke";
import { PRODUCT_NAME } from "../product-brand";
import { isTauriRuntime } from "../tauri-env";

export type SkillStudioInstallResult = {
  path: string;
  dirName: string;
  configRegistered: boolean;
  registerError?: string | null;
  gatewayReloadRecommended: boolean;
};

/** 将技能工坊草稿写入 workspace/.agents/skills/<dirName>/SKILL.md（目录已存在则拒绝）。 */
export async function installSkillStudioDraft(
  dirName: string,
  skillMd: string,
): Promise<SkillStudioInstallResult | null> {
  if (!isTauriRuntime()) {
    throw new Error(`安装技能需要在本机 ${PRODUCT_NAME} 客户端中运行`);
  }
  return invokeAuthed<SkillStudioInstallResult>("skill_studio_install_draft", {
    dirName,
    skillMd,
  });
}

/** 从安装包内置社区技能包复制到工作区（目录已存在则拒绝）。 */
export async function installCommunitySkill(dirName: string): Promise<SkillStudioInstallResult | null> {
  if (!isTauriRuntime()) {
    throw new Error(`安装技能需要在本机 ${PRODUCT_NAME} 客户端中运行`);
  }
  return invokeAuthed<SkillStudioInstallResult>("skill_studio_install_community", {
    dirName,
  });
}

export type InstalledSkillsList = {
  dirNames: string[];
  count: number;
};

/** 列出工作区已安装技能目录名。 */
export async function listInstalledSkills(): Promise<InstalledSkillsList | null> {
  if (!isTauriRuntime()) return null;
  return invokeAuthed<InstalledSkillsList>("skill_studio_list_installed", {});
}
