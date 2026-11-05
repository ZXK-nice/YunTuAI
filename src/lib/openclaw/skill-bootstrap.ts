import { invokeAuthed } from "../tauri-invoke";
import { isTauriRuntime } from "../tauri-env";

let bootstrapInFlight: Promise<number> | null = null;

/** 将 bundled 精选技能复制到 OpenClaw 工作区（幂等）。 */
export async function bootstrapCuratedSkills(opts?: {
  /** 手动触发时抛出错误，便于 UI 提示；后台静默同步仍返回 0 */
  throwOnError?: boolean;
}): Promise<number> {
  if (!isTauriRuntime()) return 0;
  if (bootstrapInFlight) return bootstrapInFlight;

  const run = invokeAuthed<number>("openclaw_bootstrap_curated_skills", {}).then((n) => {
    if (typeof n !== "number") {
      if (opts?.throwOnError) {
        throw new Error("技能同步失败（请确认已登录且本机服务可用）");
      }
      return 0;
    }
    return n;
  });

  bootstrapInFlight = (opts?.throwOnError
    ? run
    : run.catch(() => 0)
  ).finally(() => {
    bootstrapInFlight = null;
  });

  return bootstrapInFlight;
}
