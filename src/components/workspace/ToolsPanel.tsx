import { memo, useEffect, useMemo, useState, useRef, useCallback } from "react";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { fetchModuleList, type ModuleInfo } from "../../lib/module-bridge";
import { useAgentStore } from "../../stores/agentStore";
import { useGatewayStore } from "../../stores/gatewayStore";
import { isTauriRuntime } from "../../lib/tauri-env";
import { gsap } from "../../lib/gsap/setup";
import { prefersReducedMotion } from "../../lib/gsap/setup";
import {
  discoverGatewayToolsAndSkills,
  enrichMcpsWithTools,
  mergeGatewaySkillsWithAgentNames,
  partitionGatewaySkills,
  type GatewayToolInfo,
  type GatewaySkillInfo,
  type GatewayMCPInfo,
} from "../../lib/openclaw/gateway-tools";
import { installGatewaySkill, searchGatewaySkills } from "../../lib/openclaw/skills-bridge";
import { bootstrapCuratedSkills } from "../../lib/openclaw/skill-bootstrap";
import { reloadGatewayAfterSkillInstall } from "../../lib/skills/skill-install-reload";
import { CURATED_SKILL_ENTRIES } from "../../lib/skills/curated-skills";
import { useUiStore } from "../../stores/uiStore";
import type { NavKey } from "../../types/app-nav";

/* ── SVG Icons ────────────────────────────────── */

function IconWrench({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    </svg>
  );
}

function IconLightning({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function IconPuzzle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.611a2.404 2.404 0 0 1-1.705.706 2.404 2.404 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.404 2.404 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.611-1.611a2.404 2.404 0 0 1 1.704-.706c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.969a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
    </svg>
  );
}

function IconModule({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

/* ── 带悬浮描述的 Skill Chip ─────────────────── */

const SkillChip = memo(function SkillChip({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  const desc = description || "AI 内置能力模块，提供自动化处理与智能决策支持";
  return (
    <span className="group/chip relative inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1 text-[11px] transition-all duration-200 hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:shadow-md"
    >
      <span className="h-1 w-1 rounded-full bg-[var(--text-muted)]/40 transition-colors group-hover/chip:bg-[var(--text-tertiary)]/70" />
      <code className="font-mono text-[var(--text-primary)]">{name}</code>

      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-snug text-[var(--text-secondary)] opacity-0 shadow-lg transition-all duration-200 group-hover/chip:opacity-100">
        <span className="text-[10px] font-semibold text-[var(--text-secondary)] block mb-0.5">主要功能</span>
        {desc}
        <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[var(--border-subtle)]" />
      </div>
    </span>
  );
});

/* ── 带悬浮描述的 Tool Chip ─────────────────── */

const ToolChip = memo(function ToolChip({
  name,
  description,
}: {
  name: string;
  description?: string;
}) {
  const desc = description || "无详细描述";
  return (
    <span className="group/chip relative inline-flex shrink-0 cursor-default items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1 text-[11px] transition-all duration-200 hover:border-[var(--brand-color)]/30 hover:bg-[var(--brand-tint-8)]/50 hover:shadow-md">
      <span className="h-1 w-1 rounded-full bg-[var(--brand-color)]/40 transition-colors group-hover/chip:bg-[var(--brand-color)]/70" />
      <code className="font-mono text-[var(--text-primary)]">{name}</code>

      {/* Hover popup */}
      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 w-max max-w-[16rem] -translate-x-1/2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] leading-snug text-[var(--text-secondary)] opacity-0 shadow-lg transition-all duration-200 group-hover/chip:opacity-100">
        <span className="text-[10px] font-semibold text-[var(--brand-color)]/80 block mb-0.5">功能说明</span>
        {desc}
        <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-[var(--border-subtle)]" />
      </div>
    </span>
  );
});

/* ── 工具计数徽章 ──────────────────────────────── */

const SectionCountBadge = memo(function SectionCountBadge({ count }: { count: number }) {
  return (
    <span className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-2 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-secondary)]">
      {count} 项
    </span>
  );
});

/* ── MCP 模块卡片 ──────────────────────────────── */

const ModuleCard = memo(function ModuleCard({ module }: { module: ModuleInfo }) {
  const tools = module.manifest.tools;
  return (
    <div className="tools-module-card shrink-0 w-[22rem] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] transition-all duration-200 hover:border-[var(--brand-color)]/20 hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)]/50 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{module.manifest.name}</span>
            {module.enabled && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-400">
                启用
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] mt-0.5">
            <span>v{module.manifest.version}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--border-subtle)]" aria-hidden />
            <span className="font-mono">{module.manifest.runtime.type}</span>
            {module.manifest.author && (
              <>
                <span className="h-1 w-1 rounded-full bg-[var(--border-subtle)]" aria-hidden />
                <span>{module.manifest.author}</span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 rounded-md bg-[var(--surface-glass)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
          {tools.length}
        </div>
      </div>

      {/* Tools */}
      {tools.length > 0 && (
        <div className="px-3.5 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <ToolChip key={t.name} name={t.name} description={t.description} />
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {module.manifest.description && (
        <div className="border-t border-[var(--border-subtle)]/30 px-3.5 py-2">
          <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">{module.manifest.description}</p>
        </div>
      )}
    </div>
  );
});

/* ── 空状态 ────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 w-14 h-14 rounded-2xl bg-[var(--surface-glass)] flex items-center justify-center">
        <IconWrench className="w-6 h-6 text-[var(--text-tertiary)]" />
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)]">暂未探测到可用工具</p>
      <p className="mt-1 max-w-sm text-xs text-[var(--text-tertiary)]">
        本机服务已连接但尚未发现技能或模块。可先同步精选技能，或在下方搜索安装。
      </p>
    </div>
  );
}

const CuratedSkillsSection = memo(function CuratedSkillsSection({
  skillsMap,
  syncingSkills,
  onSync,
}: {
  skillsMap: Map<string, GatewaySkillInfo>;
  syncingSkills: boolean;
  onSync: () => void;
}) {
  return (
    <section className="relative">
      <div className="relative z-10 mb-3 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {PRODUCT_NAME} 精选办事技能
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-[var(--border-subtle)] to-transparent" />
        <button
          type="button"
          disabled={syncingSkills || !isTauriRuntime()}
          onClick={onSync}
          className="yt-transition shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
        >
          {syncingSkills ? "同步中…" : "同步精选技能"}
        </button>
      </div>
      <div className="relative z-10 grid gap-2 sm:grid-cols-2">
        {CURATED_SKILL_ENTRIES.map((s) => {
          const installed = skillsMap.has(s.id) || [...skillsMap.keys()].some((k) => k.includes(s.id));
          return (
            <div
              key={s.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-primary)]">{s.label}</span>
                <span
                  className={[
                    "rounded px-1.5 py-0.5 text-[10px]",
                    installed
                      ? "bg-[color-mix(in_oklab,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                      : "bg-[var(--bg-hover)] text-[var(--text-muted)]",
                  ].join(" ")}
                >
                  {installed ? "已就绪" : "待同步"}
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
});

/* ── 连接警告 ────────────────────────────────── */

function ConnectionWarning() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
        <svg className="w-5 h-5 text-[var(--color-warn)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      </div>
      <p className="text-sm font-medium text-[var(--warn-text)]">未连接到本机服务</p>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">连接后此处将显示 AI 可调用的所有工具与技能。</p>
    </div>
  );
}

/* ── 背景浮动粒子 ────────────────────────────── */

function FloatingBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId = 0;
    const particles: { x: number; y: number; r: number; dx: number; dy: number; alpha: number }[] = [];

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    // Create ~30 slow-drift dots
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2 + 0.5,
        dx: (Math.random() - 0.5) * 0.3,
        dy: (Math.random() - 0.5) * 0.3,
        alpha: Math.random() * 0.25 + 0.05,
      });
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168,85,247,${p.alpha})`;
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      aria-hidden
    />
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 4v6h6" />
      <path d="M23 20v-6h-6" />
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
    </svg>
  );
}

/* ── 技能分区（静态网格，便于阅读） ─────────────── */

const SkillGridSection = memo(function SkillGridSection({
  title,
  hint,
  accent,
  items,
  badge,
}: {
  title: string;
  hint?: string;
  accent: string;
  badge?: string;
  items: GatewaySkillInfo[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="relative">
      <div className="relative z-10 mb-3 flex items-center gap-2">
        <span className="text-[var(--text-tertiary)] shrink-0" style={{ color: accent }}>
          <IconPuzzle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] shrink-0">
              {title}
            </span>
            {badge ? (
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
                {badge}
              </span>
            ) : null}
          </div>
          {hint ? <p className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{hint}</p> : null}
        </div>
        <span className="h-px flex-1 bg-gradient-to-r from-[var(--border-subtle)] to-transparent" />
        <SectionCountBadge count={items.length} />
      </div>
      <div className="relative z-10 rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--surface-glass)]/60 p-3 backdrop-blur-sm">
        <div className="flex flex-wrap gap-1.5">
          {items.map((s) => (
            <SkillChip
              key={s.name}
              name={s.name}
              description={
                s.description ??
                (s.disabled
                  ? "已禁用或未通过 Agent 过滤"
                  : s.blockedByAgentFilter
                    ? "当前 Agent 白名单未包含此技能"
                    : undefined)
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
});

/* ── 技能安装 ─────────────────────────────────── */

const SkillInstallBar = memo(function SkillInstallBar({
  connected,
  onInstalled,
}: {
  connected: boolean;
  onInstalled: () => void;
}) {
  const showToast = useUiStore((s) => s.showToast);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ name: string; description?: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const onSearch = useCallback(() => {
    if (!connected) {
      showToast("请先连接本机服务", "info");
      return;
    }
    void searchGatewaySkills(query).then(setHits);
  }, [connected, query, showToast]);

  const onInstall = useCallback(
    async (name: string) => {
      setBusy(true);
      const r = await installGatewaySkill(name);
      if (r.ok) {
        const reload = await reloadGatewayAfterSkillInstall({ expectedSkillName: name });
        showToast(reload.message, reload.skillsStatusOk ? "success" : "warning");
        onInstalled();
      } else {
        showToast(r.message ?? "安装失败", "error");
      }
      setBusy(false);
    },
    [onInstalled, showToast],
  );

  if (!connected) return null;

  return (
    <section className="relative z-10 mb-6 rounded-xl border border-[var(--border-subtle)]/50 bg-[var(--surface-glass)]/70 p-4 backdrop-blur-sm">
      <div className="text-xs font-semibold text-[var(--text-secondary)]">安装本机技能</div>
      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">搜索并安装技能包（需本机服务已连接）</p>
      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
          placeholder="例如 wps、browser、github"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
        />
        <button type="button" className="yt-btn-svc shrink-0" onClick={onSearch}>
          搜索
        </button>
      </div>
      {hits.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {hits.map((h) => (
            <li
              key={h.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-[var(--text-primary)]">{h.name}</div>
                {h.description ? (
                  <div className="text-[10px] text-[var(--text-tertiary)] line-clamp-2">{h.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={busy}
                className="shrink-0 rounded-lg bg-[var(--brand-color)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                onClick={() => void onInstall(h.name)}
              >
                安装
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
});

/* ── 主面板 ──────────────────────────────────── */

export const ToolsPanel = memo(function ToolsPanel({
  onNav,
}: {
  onNav?: (k: NavKey) => void;
}) {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [syncingSkills, setSyncingSkills] = useState(false);
  const [gatewayDiscovery, setGatewayDiscovery] = useState<{
    tools: GatewayToolInfo[];
    skills: GatewaySkillInfo[];
    mcps: GatewayMCPInfo[];
  } | null>(null);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const connState = useGatewayStore((s) => s.connState);
  const connected = connState === "connected";
  const showToast = useUiStore((s) => s.showToast);
  const requestNavToSettings = useUiStore((s) => s.requestNavToSettings);

  const allTools = useMemo(() => gatewayDiscovery?.tools ?? [], [gatewayDiscovery]);

  const mcps = useMemo(
    () => enrichMcpsWithTools(gatewayDiscovery?.mcps ?? [], allTools),
    [gatewayDiscovery, allTools],
  );

  const nativeTools = useMemo(
    () => allTools.filter((t) => t.origin !== "mcp" && t.origin !== "mcp-server"),
    [allTools],
  );

  const mergedSkills = useMemo(() => {
    const agentSkillNames = agents.flatMap((a) => a.skills);
    return mergeGatewaySkillsWithAgentNames(gatewayDiscovery?.skills ?? [], agentSkillNames);
  }, [gatewayDiscovery, agents]);

  const { native: nativeSkills, userInstalled: userSkills } = useMemo(
    () => partitionGatewaySkills(mergedSkills),
    [mergedSkills],
  );

  const skillsMap = useMemo(() => {
    const map = new Map<string, GatewaySkillInfo>();
    for (const s of mergedSkills) map.set(s.name, s);
    return map;
  }, [mergedSkills]);

  const enabledModules = useMemo(() => modules.filter((m) => m.enabled), [modules]);
  const disabledModules = useMemo(() => modules.filter((m) => !m.enabled), [modules]);

  const mcpToolCount = useMemo(() => mcps.reduce((a, m) => a + (m.toolCount ?? 0), 0), [mcps]);
  const totalCounts = {
    mcp: mcpToolCount,
    native: nativeTools.length,
    skills: mergedSkills.length,
    all: mcpToolCount + nativeTools.length + mergedSkills.length,
  };

  // Load modules from Rust IPC
  useEffect(() => {
    if (!isTauriRuntime()) { setLoading(false); return; }
    let cancelled = false;
    void fetchModuleList().then((list) => {
      if (!cancelled) { setModules(list ?? []); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const refreshDiscovery = useCallback(async () => {
    if (!connected) {
      setGatewayDiscovery(null);
      return;
    }
    setDiscovering(true);
    try {
      const [discovery] = await Promise.all([
        discoverGatewayToolsAndSkills(),
        loadAgents(),
        isTauriRuntime() ? fetchModuleList().then((list) => setModules(list ?? [])) : Promise.resolve(),
      ]);
      setGatewayDiscovery(discovery);
      setLastRefreshedAt(Date.now());
    } finally {
      setDiscovering(false);
    }
  }, [connected, loadAgents]);

  const syncCuratedSkills = useCallback(async () => {
    if (!isTauriRuntime() || syncingSkills) return;
    setSyncingSkills(true);
    try {
      const n = await bootstrapCuratedSkills({ throwOnError: true });
      showToast(n > 0 ? `已同步 ${n} 个精选技能` : "精选技能已是最新", "success");
      refreshDiscovery();
      const list = await fetchModuleList();
      setModules(list ?? []);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSyncingSkills(false);
    }
  }, [refreshDiscovery, showToast, syncingSkills]);

  useEffect(() => {
    if (!connected) {
      setGatewayDiscovery(null);
      return;
    }
    void refreshDiscovery();
  }, [connected, refreshDiscovery]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && connected) {
        void refreshDiscovery();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [connected, refreshDiscovery]);

  // Animate cards on first load
  const containerRef = useRef<HTMLDivElement>(null);
  const animateCards = useCallback(() => {
    if (prefersReducedMotion()) return;
    const cards = containerRef.current?.querySelectorAll<HTMLElement>(".tools-module-card");
    if (!cards?.length) return;
    gsap.fromTo(cards, { opacity: 0, y: 12, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.4, stagger: 0.06, ease: "power2.out" });
  }, []);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => animateCards(), 80);
      return () => clearTimeout(t);
    }
  }, [loading, mcps, mergedSkills, animateCards]);

  const hasContent = totalCounts.all > 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Animated background */}
      <FloatingBg />

      {/* Subtle neutral backdrop */}
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 60% at 20% 30%, var(--text-muted) 0%, transparent 100%)," +
            "radial-gradient(ellipse 60% 50% at 80% 70%, var(--text-tertiary) 0%, transparent 100%)",
        }}
        aria-hidden
      />

      {/* Fixed header */}
      <div className="relative z-10 shrink-0 border-b border-[var(--separator)] bg-[var(--bg-elevated)]/60 backdrop-blur-xl">
        <div className="px-6 py-4">
          {onNav ? (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNav("imageStudio")}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--brand-color)] hover:text-[var(--brand-color)]"
              >
                作图工作室
              </button>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold text-[var(--text-primary)]">工具</h1>
              <p className="mt-0.5 text-xs text-[var(--text-tertiary)] leading-relaxed">
                本机服务实时能力 — 内置 / 工作区技能、MCP 与工具
                {lastRefreshedAt ? (
                  <span className="ml-1 tabular-nums">
                    · 更新于 {new Date(lastRefreshedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {connected ? (
                <button
                  type="button"
                  disabled={discovering}
                  onClick={() => void refreshDiscovery()}
                  className="yt-transition inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-2.5 py-1.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
                >
                  <IconRefresh className={discovering ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  {discovering ? "刷新中" : "刷新"}
                </button>
              ) : null}
              {!loading && hasContent ? (
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1.5 text-center min-w-[3.5rem]">
                  <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)] leading-tight">{totalCounts.all}</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] leading-tight mt-0.5">总数</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div ref={containerRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                加载中…
              </div>
            </div>
          ) : !connected ? (
            <ConnectionWarning />
          ) : !hasContent ? (
            <div className="space-y-8">
              <EmptyState />
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={discovering}
                  onClick={() => void refreshDiscovery()}
                  className="yt-transition rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)] disabled:opacity-50"
                >
                  {discovering ? "探测中…" : "重新探测能力"}
                </button>
                <button
                  type="button"
                  onClick={() => requestNavToSettings()}
                  className="yt-transition rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-glass)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:border-[var(--brand-color)] hover:text-[var(--brand-color)]"
                >
                  打开软件设置
                </button>
              </div>
              <SkillInstallBar connected={connected} onInstalled={() => void refreshDiscovery()} />
              <CuratedSkillsSection
                skillsMap={skillsMap}
                syncingSkills={syncingSkills}
                onSync={() => void syncCuratedSkills()}
              />
            </div>
          ) : (
            <div className="space-y-8">
              <SkillInstallBar connected={connected} onInstalled={() => void refreshDiscovery()} />

              <CuratedSkillsSection
                skillsMap={skillsMap}
                syncingSkills={syncingSkills}
                onSync={() => void syncCuratedSkills()}
              />

              <SkillGridSection
                title="内置技能"
                hint={`随 ${PRODUCT_NAME} 内置运行时自带，非工作区安装`}
                accent="var(--text-tertiary)"
                badge="原生"
                items={nativeSkills}
              />

              <SkillGridSection
                title="工作区 / 用户技能"
                hint="技能工坊、社区包或精选同步安装到 workspace/.agents/skills"
                accent="var(--text-tertiary)"
                badge="用户"
                items={userSkills}
              />

              {enabledModules.length > 0 && (
                <section className="relative">
                  <div className="relative z-10 mb-3 flex items-center gap-2">
                    <span className="text-[var(--text-tertiary)] shrink-0" style={{ color: "var(--brand-color)" }}>
                      <IconModule className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] shrink-0">
                      {PRODUCT_NAME} 本地模块
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-[var(--border-subtle)] to-transparent" />
                    <SectionCountBadge count={enabledModules.length} />
                  </div>
                  <div className="relative z-10 space-y-3">
                    {enabledModules.map((m) => (
                      <ModuleCard key={m.manifest.id} module={m} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                    更多模块可在
                    <button
                      type="button"
                      className="yt-transition mx-1 text-[var(--brand-color)] underline-offset-2 hover:underline"
                      onClick={() => requestNavToSettings("modules")}
                    >
                      设置 → 模块管理
                    </button>
                    安装或停用。
                  </p>
                </section>
              )}

              {/* ── 区块 2: MCP 模块（从 网关 配置文件实时扫描）─── */}
              <section className="relative">
                <div className="relative z-10 mb-3 flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)] shrink-0" style={{ color: "var(--brand-color)" }}>
                    <IconModule className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] shrink-0">
                    MCP 模块
                  </span>
                  <span className="h-px flex-1 bg-gradient-to-r from-[var(--border-subtle)] to-transparent" />
                  <SectionCountBadge count={mcpToolCount} />
                </div>

                {mcps.length > 0 ? (
                  <div className="relative z-10 rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--surface-glass)]/60 p-3 backdrop-blur-sm">
                    <div className="space-y-3">
                      {mcps.map((mcp) => (
                        <div key={mcp.name} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 py-2.5 transition-colors hover:border-[var(--brand-color)]/20">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className={`h-2 w-2 shrink-0 rounded-full ${mcp.enabled !== false ? "bg-emerald-400" : "bg-[var(--text-muted)]"}`} />
                            <span className="text-sm font-medium text-[var(--text-primary)]">{mcp.name}</span>
                            {mcp.enabled !== false ? (
                              <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-400">
                                启用
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">
                                已停用
                              </span>
                            )}
                            {mcp.command ? (
                              <span className="text-[10px] text-[var(--text-muted)] font-mono">{mcp.command}</span>
                            ) : null}
                            <span className="ml-auto text-[10px] tabular-nums text-[var(--text-tertiary)]">
                              {mcp.toolCount ?? 0} 个工具
                            </span>
                          </div>
                          {mcp.description ? (
                            <p className="mt-1 text-[11px] text-[var(--text-tertiary)] leading-relaxed">{mcp.description}</p>
                          ) : null}
                          {mcp.tools.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)]/40 pt-2">
                              {mcp.tools.map((t) => (
                                <ToolChip key={t.name} name={t.name.includes(".") ? t.name.split(".").slice(1).join(".") : t.name} description={t.description} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="relative z-10 rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--surface-glass)]/60 p-6 backdrop-blur-sm text-center">
                    <p className="text-xs text-[var(--text-tertiary)]">暂无 MCP 模块，安装后自动显示在此处。</p>
                  </div>
                )}
              </section>

              {/* ── 区块 2: 内置工具（静态不滚动）─── */}
              {nativeTools.length > 0 && (
                <section className="relative">
                  <div className="relative z-10 mb-3 flex items-center gap-2">
                    <span className="text-[var(--accent-blue,var(--text-tertiary))] shrink-0">
                      <IconLightning className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] shrink-0">
                      本机原生工具
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-[var(--border-subtle)] to-transparent" />
                    <SectionCountBadge count={nativeTools.length} />
                  </div>
                  <div className="relative z-10 rounded-xl border border-[var(--border-subtle)]/40 bg-[var(--surface-glass)]/60 p-3 backdrop-blur-sm">
                    <div className="flex flex-wrap gap-1.5">
                      {nativeTools.map((t) => (
                        <ToolChip key={t.name} name={t.name} description={t.description} />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {disabledModules.length > 0 && (
                <details className="group">
                  <summary className="cursor-pointer text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors">
                    {disabledModules.length} 个已停用模块
                  </summary>
                  <div className="mt-3 space-y-3">
                    {disabledModules.map((m) => (
                      <ModuleCard key={m.manifest.id} module={m} />
                    ))}
                  </div>
                </details>
              )}

              <div className="pb-8 text-center text-[10px] text-[var(--text-tertiary)]">
                {mcps.length} 个 MCP · {nativeTools.length} 个原生工具 · {nativeSkills.length} 内置技能 · {userSkills.length} 用户技能
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
