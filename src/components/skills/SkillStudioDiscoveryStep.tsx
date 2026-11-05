import { memo, useCallback, useEffect, useMemo, useState } from "react";

import type { SkillStudioDraftInput } from "../../lib/skills/skill-md-draft";

import {

  buildDiscoveryQuestions,

  countAnsweredRequired,

  formatDiscoveryBrief,

  isDiscoverySufficient,

  resolveDiscoveryContext,

  type DiscoveryQuestion,

} from "../../lib/skills/skill-studio-discovery";

import { fetchAiDiscoveryFollowUps } from "../../lib/skills/skill-studio-discovery-ai";

import { buildDiscoveryChatPrompt } from "../../lib/skills/skill-studio-prompt";

import { useSessionStore } from "../../stores/sessionStore";

import { useUiStore } from "../../stores/uiStore";

import { useGatewayStore } from "../../stores/gatewayStore";

import {

  StudioFooter,

  StudioGhostButton,

  StudioPrimaryButton,

  studioInputClass,

} from "./skill-studio-ui";



type Props = {

  draftInput: SkillStudioDraftInput;

  onBack: () => void;

  onGenerate: (answers: Record<string, string>) => void;

  generating: boolean;

};



const DiscoveryQuestionCard = memo(function DiscoveryQuestionCard({

  index,

  question,

  value,

  onChange,

}: {

  index: number;

  question: DiscoveryQuestion;

  value: string;

  onChange: (value: string) => void;

}) {

  const filled = value.trim().length > 0;

  return (

    <div

      className={[

        "rounded-[var(--radius-md)] border p-4 transition-colors",

        filled

          ? "border-[color-mix(in_oklab,var(--brand-color)_30%,var(--border-subtle))] bg-[var(--brand-tint-8)]/30"

          : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40",

      ].join(" ")}

    >

      <div className="flex gap-3">

        <span

          className={[

            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",

            filled

              ? "bg-[var(--brand-color)] text-white"

              : "bg-[var(--surface-2)] text-[var(--text-tertiary)]",

          ].join(" ")}

        >

          {filled ? "✓" : index + 1}

        </span>

        <div className="min-w-0 flex-1">

          <div className="flex flex-wrap items-center gap-2">

            <p className="text-sm font-medium text-[var(--text-primary)]">{question.question}</p>

            {question.optional && (

              <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">

                选填

              </span>

            )}

          </div>

          {question.hint && (

            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{question.hint}</p>

          )}

          <textarea

            rows={3}

            value={value}

            onChange={(e) => onChange(e.target.value)}

            placeholder={question.placeholder ?? "用你的话回答，越具体越好…"}

            className={`${studioInputClass} mt-3`}

          />

        </div>

      </div>

    </div>

  );

});



export const SkillStudioDiscoveryStep = memo(function SkillStudioDiscoveryStep({

  draftInput,

  onBack,

  onGenerate,

  generating,

}: Props) {

  const showToast = useUiStore((s) => s.showToast);

  const queueComposerLine = useUiStore((s) => s.queueComposerLine);

  const requestNavToComposeChat = useUiStore((s) => s.requestNavToComposeChat);

  const enterComposeMode = useSessionStore((s) => s.enterComposeMode);

  const gatewayOnline = useGatewayStore((s) => s.connState === "connected");



  const ctx = useMemo(() => resolveDiscoveryContext(draftInput), [draftInput]);

  const baseQuestions = useMemo(() => (ctx ? buildDiscoveryQuestions(ctx) : []), [ctx]);

  const [extraQuestions, setExtraQuestions] = useState<DiscoveryQuestion[]>([]);

  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [loadingFollowUp, setLoadingFollowUp] = useState(false);



  const questions = useMemo(() => [...baseQuestions, ...extraQuestions], [baseQuestions, extraQuestions]);



  useEffect(() => {

    setExtraQuestions([]);

    setAnswers({});

  }, [draftInput.industryId, draftInput.roleId, draftInput.selectedScenarioIds.join(",")]);



  const sufficient = isDiscoverySufficient(questions, answers);

  const brief = formatDiscoveryBrief(questions, answers);

  const progress = countAnsweredRequired(questions, answers);

  const answeredCount = questions.filter((q) => (answers[q.id]?.trim() ?? "").length > 0).length;



  const setAnswer = useCallback((id: string, value: string) => {

    setAnswers((prev) => ({ ...prev, [id]: value }));

  }, []);



  const handleAiFollowUp = useCallback(async () => {

    if (!gatewayOnline) {

      showToast("连接服务后可使用 AI 追问", "info");

      return;

    }

    setLoadingFollowUp(true);

    try {

      const followUps = await fetchAiDiscoveryFollowUps(draftInput, questions, answers);

      if (followUps.length === 0) {

        showToast("暂未生成追问，可补充上文后重试", "info");

        return;

      }

      setExtraQuestions((prev) => [...prev, ...followUps]);

      showToast(`AI 追加了 ${followUps.length} 个问题`, "success");

    } finally {

      setLoadingFollowUp(false);

    }

  }, [answers, draftInput, gatewayOnline, questions, showToast]);



  const handleDeepChat = useCallback(() => {

    if (!ctx) return;

    const scenarioSummary =

      ctx.scenarios.length > 0

        ? ctx.scenarios.map((s) => s.label).join("、")

        : draftInput.customScenarioText?.trim() || "";

    const prompt = buildDiscoveryChatPrompt(ctx.industryLabel, ctx.roleLabel, brief, scenarioSummary);

    enterComposeMode();

    queueComposerLine(prompt);

    requestNavToComposeChat();

    showToast("已跳到对话，AI 会先访谈你再写技能", "success");

  }, [

    brief,

    ctx,

    draftInput.customScenarioText,

    enterComposeMode,

    queueComposerLine,

    requestNavToComposeChat,

    showToast,

  ]);



  if (!ctx) return null;



  return (

    <div className="flex flex-col gap-5">

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--brand-color)_22%,var(--border-subtle))] bg-[var(--brand-tint-8)]/40 px-4 py-3">

        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">

          回答下面几个问题，生成的技能会更贴近你在

          <strong className="text-[var(--text-primary)]"> {ctx.industryLabel} · {ctx.roleLabel} </strong>

          上的真实习惯。可一次填完，也可先跳过再生成。

        </p>

        <div className="mt-3 flex items-center gap-3">

          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">

            <div

              className="h-full rounded-full bg-[var(--brand-color)] transition-all duration-300"

              style={{ width: `${questions.length ? (answeredCount / questions.length) * 100 : 0}%` }}

            />

          </div>

          <span className="shrink-0 text-xs tabular-nums text-[var(--text-tertiary)]">

            {answeredCount}/{questions.length}

          </span>

        </div>

      </div>



      <div className="flex max-h-[min(52vh,28rem)] flex-col gap-3 overflow-y-auto pr-0.5 [-ms-overflow-style:thin] [scrollbar-width:thin]">

        {questions.map((q, idx) => (

          <DiscoveryQuestionCard

            key={q.id}

            index={idx}

            question={q}

            value={answers[q.id] ?? ""}

            onChange={(v) => setAnswer(q.id, v)}

          />

        ))}

      </div>



      <div className="flex flex-wrap gap-2">

        {gatewayOnline && (

          <button

            type="button"

            disabled={loadingFollowUp || brief.length < 20}

            onClick={() => void handleAiFollowUp()}

            className="yt-btn-emphasis yt-transition rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"

          >

            {loadingFollowUp ? "思考中…" : "AI 再问我几句"}

          </button>

        )}

        <StudioGhostButton onClick={handleDeepChat}>和 AI 深入聊聊</StudioGhostButton>

      </div>



      <StudioFooter

        onBack={onBack}

        hint={

          sufficient

            ? undefined

            : `建议再回答 ${Math.max(0, Math.min(progress.required, 2) - progress.answered)} 个核心问题`

        }

      >

        <StudioGhostButton disabled={generating} onClick={() => onGenerate(answers)}>

          暂时跳过

        </StudioGhostButton>

        <StudioPrimaryButton disabled={!sufficient || generating} onClick={() => onGenerate(answers)}>

          {generating ? "生成中…" : "生成专属技能"}

        </StudioPrimaryButton>

      </StudioFooter>

    </div>

  );

});


