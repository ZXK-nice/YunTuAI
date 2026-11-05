import { getGatewayClient } from "../openclaw/gateway-runtime";
import {
  fetchAssistantBaseline,
  pollForNewAssistantAfterSend,
} from "../openclaw/chat-history-sync";
import { useSessionStore } from "../../stores/sessionStore";
import type { SkillStudioDraftInput } from "./skill-md-draft";
import {
  formatDiscoveryBrief,
  parseAiFollowUpQuestions,
  resolveDiscoveryContext,
  type DiscoveryQuestion,
} from "./skill-studio-discovery";

function resolveSessionKey(): string | null {
  const { sessions, activeId } = useSessionStore.getState();
  const active = sessions.find((s) => s.id === activeId);
  return active?.remoteSessionKey?.trim() || null;
}

function buildFollowUpPrompt(
  input: SkillStudioDraftInput,
  questions: DiscoveryQuestion[],
  answers: Record<string, string>,
): string {
  const ctx = resolveDiscoveryContext(input);
  const brief = formatDiscoveryBrief(questions, answers);
  return `你是技能工坊访谈助手。用户要为「${ctx?.industryLabel ?? ""} / ${ctx?.roleLabel ?? ""}」定制 Agent Skill（SKILL.md）。

已收集的回答：
${brief || "（尚无）"}

请根据上面信息，再提出 2–3 个**简短、具体**的追问，帮助把技能写得更贴身。不要重复已问过的问题。

只输出 JSON 数组，格式：
[{"question":"问题文字","placeholder":"填写提示","hint":"为何问"}]

不要输出其它文字。`;
}

/** 联网时根据已有回答生成 AI 追问（失败返回空数组） */
export async function fetchAiDiscoveryFollowUps(
  input: SkillStudioDraftInput,
  questions: DiscoveryQuestion[],
  answers: Record<string, string>,
  signal?: AbortSignal,
): Promise<DiscoveryQuestion[]> {
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];

  const sessionKey = resolveSessionKey();
  if (!sessionKey) return [];

  const prompt = buildFollowUpPrompt(input, questions, answers);
  const request = (method: string, params: Record<string, unknown>) =>
    client.request(method, params, { timeoutMs: 90_000 });

  try {
    const baseline = await fetchAssistantBaseline(request, sessionKey);
    await request("sessions.send", {
      sessionKey,
      message: prompt,
      idempotencyKey: `skill-discovery-${Date.now()}`,
    });

    const reply = await pollForNewAssistantAfterSend(request, sessionKey, baseline, {
      timeoutMs: 60_000,
      signal,
      preferWs: true,
    });

    if (!reply || reply === "aborted" || reply.startsWith("[错误]")) return [];
    return parseAiFollowUpQuestions(reply);
  } catch {
    return [];
  }
}
