import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { SKILL_STUDIO_CATALOG } from "../../lib/skills/skill-studio-catalog";
import { CommunitySkillPackPanel } from "./CommunitySkillPackPanel";
import type { SkillStudioDraftInput, SkillStudioDraftResult } from "../../lib/skills/skill-md-draft";
import { buildSkillRefinementPrompt } from "../../lib/skills/skill-studio-prompt";
import { generateSkillDraft } from "../../lib/skills/skill-studio-ai-draft";
import {
  buildDiscoveryQuestions,
  formatDiscoveryBrief,
  mergeDiscoveryIntoInput,
  resolveDiscoveryContext,
} from "../../lib/skills/skill-studio-discovery";
import { installCommunitySkill, installSkillStudioDraft, listInstalledSkills } from "../../lib/skills/skill-studio-bridge";
import {
  communityBundleStats,
  isCommunitySkillInstallable,
} from "../../lib/skills/community-skill-catalog";
import { reloadGatewayAfterSkillInstall } from "../../lib/skills/skill-install-reload";
import { SkillStudioDiscoveryStep } from "./SkillStudioDiscoveryStep";
import { SkillRoleRecommendations } from "./SkillRoleRecommendations";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { isTauriRuntime } from "../../lib/tauri-env";
import {
  CollapsibleSection,
  StudioBadge,
  StudioChip,
  StudioField,
  StudioFooter,
  StudioGhostButton,
  StudioIndustryCard,
  StudioPanel,
  StudioPrimaryButton,
  StudioScenarioCard,
  StudioSection,
  StudioShell,
  StudioStepHeader,
  industryGlyph,
  studioInputClass,
  type WizardStepId,
} from "./skill-studio-ui";

export const SkillStudioPanel = memo(function SkillStudioPanel() {
  const showToast = useUiStore((s) => s.showToast);
  const queueComposerLine = useUiStore((s) => s.queueComposerLine);
  const requestNavToComposeChat = useUiStore((s) => s.requestNavToComposeChat);
  const enterComposeMode = useSessionStore((s) => s.enterComposeMode);
  const gatewayOnline = useGatewayStore((s) => s.connState === "connected");

  const [step, setStep] = useState<WizardStepId>(1);
  const [industryId, setIndustryId] = useState<string | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [customNotes, setCustomNotes] = useState("");
  const [customIndustryLabel, setCustomIndustryLabel] = useState("");
  const [customRoleLabel, setCustomRoleLabel] = useState("");
  const [customScenarioText, setCustomScenarioText] = useState("");
  const [draft, setDraft] = useState<SkillStudioDraftResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installingCommunityDir, setInstallingCommunityDir] = useState<string | null>(null);
  const [installingRecommendations, setInstallingRecommendations] = useState(false);
  const [installedSkillDirs, setInstalledSkillDirs] = useState<Set<string>>(new Set());
  const [selectedRecommendationDirs, setSelectedRecommendationDirs] = useState<Set<string>>(new Set());
  const [industryQuery, setIndustryQuery] = useState("");

  const industry = useMemo(
    () => SKILL_STUDIO_CATALOG.find((i) => i.id === industryId) ?? null,
    [industryId],
  );
  const role = useMemo(
    () => industry?.roles.find((r) => r.id === roleId) ?? null,
    [industry, roleId],
  );
  const isCustomIndustry = industry?.custom === true;

  const filteredIndustries = useMemo(() => {
    const q = industryQuery.trim().toLowerCase();
    if (!q) return SKILL_STUDIO_CATALOG;
    return SKILL_STUDIO_CATALOG.filter(
      (ind) =>
        ind.label.toLowerCase().includes(q) ||
        ind.description.toLowerCase().includes(q) ||
        ind.roles.some((r) => r.label.toLowerCase().includes(q)),
    );
  }, [industryQuery]);

  const draftInput: SkillStudioDraftInput | null = useMemo(() => {
    if (!industryId || !roleId) return null;
    return {
      industryId,
      roleId,
      selectedScenarioIds,
      customNotes,
      customIndustryLabel,
      customRoleLabel,
      customScenarioText,
    };
  }, [
    industryId,
    roleId,
    selectedScenarioIds,
    customNotes,
    customIndustryLabel,
    customRoleLabel,
    customScenarioText,
  ]);

  const contextLabel = useMemo(() => {
    if (!industry || !role) return null;
    if (isCustomIndustry) {
      return `${customIndustryLabel.trim() || "其他"} · ${customRoleLabel.trim() || "自定义岗位"}`;
    }
    return `${industry.label} · ${role.label}`;
  }, [customIndustryLabel, customRoleLabel, industry, isCustomIndustry, role]);

  const communityPackSubtitle = useMemo(() => {
    const s = communityBundleStats();
    return s.installableCount > 0
      ? `目录 ${s.catalogCount} 个技能，本包可安装 ${s.installableCount} 个`
      : `目录 ${s.catalogCount} 个技能，可浏览选择（安装需完整技能包）`;
  }, []);

  const refreshInstalledSkills = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const list = await listInstalledSkills();
      if (list?.dirNames) {
        setInstalledSkillDirs(new Set(list.dirNames));
      }
    } catch {
      /* 未登录或网关未初始化时忽略 */
    }
  }, []);

  useEffect(() => {
    void refreshInstalledSkills();
  }, [refreshInstalledSkills]);

  const installRecommendationBatch = useCallback(
    async (dirs: string[]) => {
      if (dirs.length === 0) return { installed: 0, skipped: 0 };
      if (!isTauriRuntime()) {
        showToast("请在本机客户端中安装推荐技能", "error");
        return { installed: 0, skipped: dirs.length };
      }
      setInstallingRecommendations(true);
      let installed = 0;
      let skipped = 0;
      try {
        for (const dirName of dirs) {
          if (installedSkillDirs.has(dirName)) {
            skipped += 1;
            continue;
          }
          if (!isCommunitySkillInstallable(dirName)) {
            skipped += 1;
            continue;
          }
          try {
            const result = await installCommunitySkill(dirName);
            if (result) {
              installed += 1;
              setInstalledSkillDirs((prev) => new Set([...prev, dirName]));
            }
          } catch {
            skipped += 1;
          }
        }
        if (installed > 0) {
          const reload = await reloadGatewayAfterSkillInstall();
          showToast(
            `已安装 ${installed} 个推荐技能${skipped > 0 ? `，${skipped} 个跳过` : ""}；${reload.message}`,
            reload.skillsStatusOk ? "success" : "warning",
          );
        }
      } finally {
        setInstallingRecommendations(false);
        await refreshInstalledSkills();
      }
      return { installed, skipped };
    },
    [installedSkillDirs, refreshInstalledSkills, showToast],
  );

  const handleStep1Next = useCallback(async () => {
    const toInstall = [...selectedRecommendationDirs].filter(
      (d) => !installedSkillDirs.has(d) && isCommunitySkillInstallable(d),
    );
    if (toInstall.length > 0) {
      await installRecommendationBatch(toInstall);
    }
    setStep(2);
  }, [installRecommendationBatch, installedSkillDirs, selectedRecommendationDirs]);

  const toggleScenario = useCallback((id: string) => {
    setSelectedScenarioIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const canGoStep2 = Boolean(
    industryId && roleId && (!isCustomIndustry || customRoleLabel.trim().length > 0),
  );

  const canGoStep3 = useMemo(() => {
    if (!canGoStep2) return false;
    if (isCustomIndustry) {
      return customScenarioText.trim().length > 0 || customNotes.trim().length > 0;
    }
    return selectedScenarioIds.length > 0 || customNotes.trim().length > 0;
  }, [canGoStep2, isCustomIndustry, customScenarioText, customNotes, selectedScenarioIds]);

  const goToStep = useCallback((target: WizardStepId) => {
    if (target === 2 && !canGoStep2) return;
    if (target === 3 && !canGoStep3) return;
    if (target === 4 && !draft) return;
    setStep(target);
  }, [canGoStep2, canGoStep3, draft]);

  const runGenerateDraft = useCallback(
    async (discoveryAnswers: Record<string, string> = {}) => {
      if (!draftInput) return;
      setGenerating(true);
      setDraft(null);
      try {
        const ctx = resolveDiscoveryContext(draftInput);
        const questions = ctx ? buildDiscoveryQuestions(ctx) : [];
        const brief = formatDiscoveryBrief(questions, discoveryAnswers);
        const mergedInput = mergeDiscoveryIntoInput(draftInput, brief);

        const result = await generateSkillDraft(mergedInput, { preferAi: gatewayOnline });
        if (!result) {
          showToast("无法生成草稿，请检查填写内容", "error");
          return;
        }
        setDraft(result);
        setStep(4);
        if (result.source === "ai") {
          showToast("已结合你的回答，用 AI 生成专属技能", "success");
        } else if (brief.trim()) {
          showToast("已根据沟通内容生成草稿", "success");
        } else {
          showToast("已生成草稿，建议先完成沟通步骤会更贴身", "info");
        }
      } finally {
        setGenerating(false);
      }
    },
    [draftInput, gatewayOnline, showToast],
  );

  const handleCopy = useCallback(async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.skillMd);
      showToast("已复制 SKILL.md 到剪贴板", "success");
    } catch {
      showToast("复制失败，请手动选择预览区文本", "error");
    }
  }, [draft, showToast]);

  const handleDownload = useCallback(() => {
    if (!draft) return;
    const blob = new Blob([draft.skillMd], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "SKILL.md";
    a.click();
    URL.revokeObjectURL(url);
    showToast("已开始下载 SKILL.md", "success");
  }, [draft, showToast]);

  const handleRefineWithAi = useCallback(() => {
    if (!draft) return;
    const prompt = buildSkillRefinementPrompt(draft, customNotes, customScenarioText);
    enterComposeMode();
    queueComposerLine(prompt);
    requestNavToComposeChat();
    showToast("已跳转到对话，输入框已填入完善提示", "success");
  }, [customNotes, customScenarioText, draft, enterComposeMode, queueComposerLine, requestNavToComposeChat, showToast]);

  const handleInstall = useCallback(async () => {
    if (!draft) return;
    if (!isTauriRuntime()) {
      showToast("请在本机客户端中安装技能", "error");
      return;
    }
    setInstalling(true);
    try {
      const result = await installSkillStudioDraft(draft.dirName, draft.skillMd);
      if (!result) {
        showToast("安装失败：未登录或客户端不可用", "error");
        return;
      }
      if (result.registerError) {
        showToast(`技能已写入工作区，但配置注册失败：${result.registerError}`, "warning");
      }
      if (result.gatewayReloadRecommended) {
        const reload = await reloadGatewayAfterSkillInstall({ expectedSkillName: result.dirName });
        showToast(
          result.configRegistered
            ? reload.message
            : `已安装「${result.dirName}」；${reload.message}`,
          reload.skillsStatusOk ? "success" : "warning",
        );
      } else {
        showToast(`已安装「${result.dirName}」`, "success");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setInstalling(false);
    }
  }, [draft, showToast]);

  const handleInstallCommunity = useCallback(
    async (dirName: string) => {
      if (!isTauriRuntime()) {
        showToast("请在本机客户端中安装社区技能", "error");
        return;
      }
      if (!isCommunitySkillInstallable(dirName)) {
        showToast("当前安装包未包含此技能，请使用完整发版包或联系管理员获取技能包", "warning");
        return;
      }
      setInstallingCommunityDir(dirName);
      try {
        const result = await installCommunitySkill(dirName);
        if (!result) {
          showToast("安装失败：未登录或客户端不可用", "error");
          return;
        }
        if (result.registerError) {
          showToast(`技能已复制，配置注册失败：${result.registerError}`, "warning");
        }
        const reload = await reloadGatewayAfterSkillInstall({ expectedSkillName: result.dirName });
        showToast(reload.message, reload.skillsStatusOk ? "success" : "warning");
        await refreshInstalledSkills();
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setInstallingCommunityDir(null);
      }
    },
    [showToast, refreshInstalledSkills],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-10">
      <StudioShell
        step={step}
        gatewayOnline={gatewayOnline}
        onStepClick={goToStep}
        contextLabel={contextLabel}
        scenarioCount={selectedScenarioIds.length}
        draftDirName={draft?.dirName ?? null}
      >
      {step === 1 && (
        <StudioPanel>
          <StudioStepHeader step={step} gatewayOnline={gatewayOnline} />
          <div className="flex flex-col gap-6">
            <StudioSection title="选择行业" subtitle="先选大致领域，再选具体岗位">
              <input
                type="search"
                value={industryQuery}
                onChange={(e) => setIndustryQuery(e.target.value)}
                placeholder="搜索行业或岗位…"
                className={studioInputClass}
              />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {filteredIndustries.map((ind) => (
                  <StudioIndustryCard
                    key={ind.id}
                    label={ind.label}
                    description={ind.description}
                    glyph={industryGlyph(ind.id)}
                    roleCount={ind.custom ? undefined : ind.roles.length}
                    selected={industryId === ind.id}
                    highlight={ind.custom}
                    onClick={() => {
                      setIndustryId(ind.id);
                      setRoleId(ind.custom ? "freeform" : null);
                      setSelectedScenarioIds([]);
                    }}
                  />
                ))}
              </div>
              {filteredIndustries.length === 0 && (
                <p className="text-sm text-[var(--text-tertiary)]">没有匹配的行业，试试「其他」或换个关键词</p>
              )}
            </StudioSection>

            {industry && !isCustomIndustry && (
              <StudioSection title="选择岗位" subtitle={`已选：${industry.label}`}>
                <div className="flex flex-wrap gap-2">
                  {industry.roles.map((r) => (
                    <StudioChip
                      key={r.id}
                      selected={roleId === r.id}
                      onClick={() => {
                        setRoleId(r.id);
                        setSelectedScenarioIds([]);
                      }}
                    >
                      {r.label}
                    </StudioChip>
                  ))}
                </div>
              </StudioSection>
            )}

            {industry && isCustomIndustry && (
              <StudioSection title="描述你的身份" subtitle="行业与岗位可自由填写">
                <div className="grid gap-4 sm:grid-cols-2">
                  <StudioField label="你的行业">
                    <input
                      value={customIndustryLabel}
                      onChange={(e) => setCustomIndustryLabel(e.target.value)}
                      placeholder="医疗器械、餐饮连锁…"
                      className={studioInputClass}
                    />
                  </StudioField>
                  <StudioField label="你的岗位">
                    <input
                      value={customRoleLabel}
                      onChange={(e) => setCustomRoleLabel(e.target.value)}
                      placeholder="区域销售、店长、运营…"
                      className={studioInputClass}
                    />
                  </StudioField>
                </div>
              </StudioSection>
            )}

            {industryId && roleId && (
              <SkillRoleRecommendations
                industryId={industryId}
                roleId={roleId}
                installedDirs={installedSkillDirs}
                selectedDirs={selectedRecommendationDirs}
                onSelectedChange={setSelectedRecommendationDirs}
              />
            )}

            <StudioFooter>
              <StudioPrimaryButton
                disabled={!canGoStep2 || installingRecommendations}
                onClick={() => void handleStep1Next()}
              >
                {installingRecommendations
                  ? "安装推荐技能中…"
                  : selectedRecommendationDirs.size > 0
                    ? "安装选中技能并继续"
                    : "下一步：办事场景"}
              </StudioPrimaryButton>
            </StudioFooter>
          </div>
        </StudioPanel>
      )}

      {step === 2 && role && industry && (
        <StudioPanel>
          <StudioStepHeader step={step} gatewayOnline={gatewayOnline} />
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <StudioBadge>{contextLabel}</StudioBadge>
              {!isCustomIndustry && (
                <StudioBadge>已选 {selectedScenarioIds.length} 个场景</StudioBadge>
              )}
            </div>

            <StudioSection
              title={isCustomIndustry ? "描述办事场景" : "选择高频场景"}
              subtitle={
                isCustomIndustry
                  ? "用日常语言说明你想让 AI 帮什么"
                  : "可多选，下一步会针对你的习惯再沟通"
              }
            >
              {!isCustomIndustry ? (
                <div className="grid gap-2 lg:grid-cols-2">
                  {role.scenarios.map((s) => (
                    <StudioScenarioCard
                      key={s.id}
                      label={s.label}
                      summary={s.summary}
                      checked={selectedScenarioIds.includes(s.id)}
                      onToggle={() => toggleScenario(s.id)}
                    />
                  ))}
                </div>
              ) : (
                <textarea
                  rows={5}
                  value={customScenarioText}
                  onChange={(e) => setCustomScenarioText(e.target.value)}
                  placeholder="例如：每周渠道回款对账、经销商政策通知、大客户拜访前调研…"
                  className={studioInputClass}
                />
              )}
            </StudioSection>

            <StudioField label="补充说明（可选）" htmlFor="skill-studio-notes">
              <textarea
                id="skill-studio-notes"
                rows={3}
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="输出风格、常用工具、必须遵守的口径…"
                className={studioInputClass}
              />
            </StudioField>

            <StudioFooter onBack={() => setStep(1)}>
              <StudioPrimaryButton disabled={!canGoStep3} onClick={() => setStep(3)}>
                下一步：沟通澄清
              </StudioPrimaryButton>
            </StudioFooter>
          </div>
        </StudioPanel>
      )}

      {step === 3 && draftInput && (
        <StudioPanel>
          <StudioStepHeader step={step} gatewayOnline={gatewayOnline} />
          <SkillStudioDiscoveryStep
            draftInput={draftInput}
            onBack={() => setStep(2)}
            onGenerate={(answers) => void runGenerateDraft(answers)}
            generating={generating}
          />
        </StudioPanel>
      )}

      {step === 4 && draft && (
        <StudioPanel>
          <StudioStepHeader step={step} gatewayOnline={gatewayOnline} />
          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,15rem)_1fr] xl:items-start xl:gap-6">
            <aside className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">专属技能</h2>
                <div className="mt-2 flex flex-col gap-2">
                  <StudioBadge>{draft.industryLabel} · {draft.roleLabel}</StudioBadge>
                  <StudioBadge>
                    <code className="font-mono text-[10px]">{draft.dirName}</code>
                  </StudioBadge>
                  {draft.source === "ai" && (
                    <span className="inline-flex w-fit items-center rounded-full bg-[var(--brand-tint-8)] px-2 py-0.5 text-[10px] font-medium text-[var(--brand-color)]">
                      AI 深化
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <StudioGhostButton onClick={() => void handleCopy()}>复制 SKILL.md</StudioGhostButton>
                <StudioGhostButton onClick={handleDownload}>下载文件</StudioGhostButton>
                <StudioGhostButton onClick={handleRefineWithAi}>用 AI 完善</StudioGhostButton>
                <StudioPrimaryButton disabled={installing} onClick={() => void handleInstall()}>
                  {installing ? "安装中…" : "安装到本机"}
                </StudioPrimaryButton>
              </div>
              <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
                安装到工作区 <code className="text-[10px]">.agents/skills/</code>，不会覆盖已有同名目录。
              </p>
            </aside>

            <div className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  SKILL.md
                </span>
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{draft.dirName}</span>
              </div>
              <pre className="max-h-[min(58vh,28rem)] overflow-auto bg-[var(--surface-2)]/50 p-4 font-mono text-xs leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
                {draft.skillMd}
              </pre>
            </div>
          </div>

          <StudioFooter onBack={() => setStep(3)} backLabel="返回修改沟通" />
        </StudioPanel>
      )}
      </StudioShell>

      <CollapsibleSection
        title="云图社区技能包"
        subtitle={communityPackSubtitle}
        defaultOpen={step === 4}
      >
        <CommunitySkillPackPanel
          compact
          onInstall={(d) => void handleInstallCommunity(d)}
          installingDir={installingCommunityDir}
        />
      </CollapsibleSection>
    </div>
  );
});
