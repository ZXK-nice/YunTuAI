import { memo } from "react";
import { useUiStore } from "../../stores/uiStore";

type Props = {
  ownerUnlocked: boolean;
};

/** 设置 · 高级：未解锁时的能力说明；解锁后提供控制台入口。 */
export const AdvancedSettingsIntro = memo(function AdvancedSettingsIntro({ ownerUnlocked }: Props) {
  const requestNavToConsole = useUiStore((s) => s.requestNavToConsole);

  if (!ownerUnlocked) {
    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
        <div className="text-sm font-medium text-[var(--text-primary)]">解锁后可用的能力</div>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          <li>· 读取本机服务配置与迁移/接管工具</li>
          <li>· 用户管理与授权签发（Owner）</li>
          <li>· 高级控制台：Agent、渠道、会话、技能等全能力 RPC</li>
          <li>· 运行日志与操作审计（侧栏入口）</li>
        </ul>
        <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
          请在上方输入 Owner 密码解锁。日常模型密钥请用「模型密钥」分栏；运行时与连接在本栏上方。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-glass)] p-4">
      <div className="text-sm font-medium text-[var(--text-primary)]">高级控制台</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        全功能本机服务管理面板：概览、Agent、渠道、定时任务、会话、技能与 RPC 调试。
      </p>
      <button
        type="button"
        className="yt-btn-svc mt-3"
        onClick={() => requestNavToConsole("overview")}
      >
        打开高级控制台
      </button>
    </div>
  );
});
