import { getGatewayClient } from "./gateway-runtime";

export type SkillSearchHit = {
  name: string;
  description?: string;
  source?: string;
};

export async function searchGatewaySkills(query: string): Promise<SkillSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const client = getGatewayClient();
  if (!client.isHelloOk) return [];
  try {
    const raw = await client.request<unknown>("skills.search", { query: q, limit: 12 });
    return parseSkillHits(raw);
  } catch {
    return [];
  }
}

export async function installGatewaySkill(name: string): Promise<{ ok: boolean; message?: string }> {
  const skill = name.trim();
  if (!skill) return { ok: false, message: "技能名为空" };
  const client = getGatewayClient();
  if (!client.isHelloOk) return { ok: false, message: "本机服务未连接" };
  try {
    const raw = await client.request<unknown>("skills.install", { name: skill });
    if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (o.ok === false) {
        return { ok: false, message: String(o.error ?? o.message ?? "安装失败") };
      }
    }
    return { ok: true, message: `已安装技能「${skill}」` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

function parseSkillHits(raw: unknown): SkillSearchHit[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as Record<string, unknown>;
  const list = (Array.isArray(raw) ? raw : (r.skills ?? r.items ?? r.results)) as unknown[];
  if (!Array.isArray(list)) return [];
  const out: SkillSearchHit[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      out.push({ name: item });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.id ?? o.skill ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      description: typeof o.description === "string" ? o.description : undefined,
      source: typeof o.source === "string" ? o.source : undefined,
    });
  }
  return out;
}
