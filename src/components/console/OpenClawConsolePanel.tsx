import { useEffect, useRef, useState } from "react";
import { AdvancedConsolePanel } from "./AdvancedConsolePanel";
import {
  ConsoleAgentsSection,
  ConsoleChannelsSection,
  ConsoleCompactionSection,
  ConsoleConfigSection,
  ConsoleCronSection,
  ConsoleExecSection,
  ConsoleMemorySection,
  ConsoleNodesSection,
  ConsoleOverviewSection,
  ConsoleSessionsSection,
  ConsoleSkillsSection,
  ConsoleTtsSection,
  ConsoleUsageSection,
} from "./ConsoleSections";
import { OPENCLAW_CONSOLE_SECTIONS, type ConsoleSectionId } from "../../lib/openclaw/console-rpc";
import {
  getCachedDistributionProfile,
  isInternalDistributionProfile,
} from "../../lib/openclaw/console-control-stability";
import { profileDisplayLabel } from "../../lib/distribution-profile";
import { humanizeGatewayConn } from "../../lib/ui/gateway-ui";
import type { GatewayConnStateWord } from "../../lib/ui/gateway-ui";
import { useGatewayStore } from "../../stores/gatewayStore";
import { useUiStore } from "../../stores/uiStore";

function InteractiveSection({
  section,
  connState,
  focusSessionKey,
}: {
  section: ConsoleSectionId;
  connState: GatewayConnStateWord;
  focusSessionKey?: string;
}) {
  switch (section) {
    case "overview":
      return <ConsoleOverviewSection connState={connState} />;
    case "agents":
      return <ConsoleAgentsSection connState={connState} />;
    case "channels":
      return <ConsoleChannelsSection connState={connState} />;
    case "cron":
      return <ConsoleCronSection connState={connState} />;
    case "nodes":
      return <ConsoleNodesSection connState={connState} />;
    case "memory":
      return <ConsoleMemorySection connState={connState} />;
    case "usage":
      return <ConsoleUsageSection connState={connState} />;
    case "config":
      return <ConsoleConfigSection connState={connState} />;
    case "skills":
      return <ConsoleSkillsSection connState={connState} />;
    case "sessions":
      return <ConsoleSessionsSection connState={connState} />;
    case "compaction":
      return <ConsoleCompactionSection connState={connState} focusSessionKey={focusSessionKey} />;
    case "tts":
      return <ConsoleTtsSection connState={connState} />;
    case "exec":
      return <ConsoleExecSection connState={connState} />;
    case "rpc":
      return <AdvancedConsolePanel embedded />;
    default:
      return null;
  }
}

type Props = {
  embedded?: boolean;
};

export function OpenClawConsolePanel({ embedded: _embedded }: Props = {}) {
  const connState = useGatewayStore((s) => s.connState) as GatewayConnStateWord;
  const connHint = humanizeGatewayConn(connState);
  const [section, setSection] = useState<ConsoleSectionId>("overview");
  const [focusSessionKey, setFocusSessionKey] = useState<string | undefined>();
  const [profileNote, setProfileNote] = useState<string | null>(null);
  const consoleFocus = useUiStore((s) => s.consoleFocus);
  const consumedFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!consoleFocus) {
      consumedFocusRef.current = null;
      return;
    }
    const token = `${consoleFocus.section}:${consoleFocus.sessionKey ?? ""}`;
    if (consumedFocusRef.current === token) return;
    consumedFocusRef.current = token;
    setSection(consoleFocus.section);
    if (consoleFocus.sessionKey) setFocusSessionKey(consoleFocus.sessionKey);
    useUiStore.getState().consumeConsoleFocus();
  }, [consoleFocus]);

  useEffect(() => {
    void getCachedDistributionProfile().then((p) => {
      if (isInternalDistributionProfile(p)) {
        setProfileNote("内部版 · 控制操作不重启本机服务 · 已保护 provider 配置");
      } else if (p) {
        setProfileNote(`分发档：${profileDisplayLabel(p)}`);
      }
    });
  }, []);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4">
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-color)_6%,var(--surface-glass))] px-4 py-3">
        <p className="text-sm font-medium text-[var(--text-primary)]">本机服务全能力控制台</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
          深度控制本机服务全能力。写操作经稳定性封装：不停止监管进程、写后健康探活、内部版禁止误改中转站配置。
        </p>
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          服务状态：{connHint}
          {profileNote ? <span className="mx-2">|</span> : null}
          {profileNote}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <nav
          className="flex shrink-0 flex-row flex-wrap gap-1 lg:w-44 lg:flex-col lg:gap-0.5"
          aria-label="本机服务控制台分区"
        >
          {OPENCLAW_CONSOLE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={[
                "rounded-lg px-3 py-2 text-left text-xs transition-colors",
                section === s.id
                  ? "bg-[var(--brand-tint-12)] font-medium text-[var(--brand-color)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex min-h-[20rem] min-w-0 flex-1 flex-col rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
          <InteractiveSection section={section} connState={connState} focusSessionKey={focusSessionKey} />
        </div>
      </div>
    </div>
  );
}
