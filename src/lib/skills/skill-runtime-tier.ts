/** 社区技能运行时分档：开箱即用 vs 需额外 Python/浏览器/本地模型。 */

export type SkillRuntimeTier = "bundled" | "needs-runtime";

const RUNTIME_HEAVY_DIRS = new Set([
  "scrapling",
  "browser-use",
  "chrome-automation",
  "desktop-control",
  "qwen3-tts-local",
  "qwen3-asr-assistant",
  "infinitetalk",
  "infinitetalk-shopping-avatar",
  "video-recreation",
  "video-frame-extractor",
  "remotion-video-enhancer",
]);

const RUNTIME_HINT_RE =
  /pip\s+install|playwright|chromium|ffmpeg|edge-tts|python\s+3|需要.*python|本地模型|gpu|cuda|docker/i;

export function inferSkillRuntimeTier(
  dirName: string,
  description?: string,
): SkillRuntimeTier {
  if (RUNTIME_HEAVY_DIRS.has(dirName)) return "needs-runtime";
  const desc = description?.trim() ?? "";
  if (desc && RUNTIME_HINT_RE.test(desc)) return "needs-runtime";
  return "bundled";
}

export function skillRuntimeTierLabel(tier: SkillRuntimeTier): string {
  return tier === "needs-runtime" ? "需额外运行时" : "开箱即用";
}
