import { memo } from "react";
import { useUiStore } from "../../stores/uiStore";

/** 设置 · 更多能力：技能工坊 / 工具 / Agent 等第二层入口。 */
export const ExtendedCapabilitiesPanel = memo(function ExtendedCapabilitiesPanel() {
  const requestNavToView = useUiStore((s) => s.requestNavToView);
  const requestNavToConsole = useUiStore((s) => s.requestNavToConsole);

  return (
    <section
      id="settings-extended-capabilities"
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4"
    >
      <div className="text-sm font-medium text-[var(--text-primary)]">更多能力</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        日常办事只需「办事 / 产出 / 设置」。技能工坊、扩展工具与 Agent 控制台在此进入。
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="yt-btn-svc" onClick={() => requestNavToView("skillStudio")}>
          技能工坊
        </button>
        <button type="button" className="yt-btn-svc" onClick={() => requestNavToView("agents")}>
          Agent 指挥中心
        </button>
        <button type="button" className="yt-btn-svc" onClick={() => requestNavToView("imageStudio")}>
          作图
        </button>
        <button type="button" className="yt-btn-svc" onClick={() => requestNavToConsole("overview")}>
          高级控制台
        </button>
      </div>
    </section>
  );
});
