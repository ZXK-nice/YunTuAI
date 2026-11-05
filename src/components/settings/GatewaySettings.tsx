import { memo, useCallback, useEffect, useState, type ReactNode } from "react";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { OpenClawRuntimePanel } from "./OpenClawRuntimePanel";
import { ApiKeySettingsPanel } from "./ApiKeySettingsPanel";
import { AccountPasswordSection } from "./AccountPasswordSection";
import { CapabilityOpsPanel } from "./CapabilityOpsPanel";
import { KbAssistantSettingsPanel } from "./KbAssistantSettingsPanel";
import { ModuleManagerPanel } from "./ModuleManagerPanel";
import { SettingsLayout } from "./SettingsLayout";
import { OutputDirSettingsPanel } from "./OutputDirSettingsPanel";
import { RuntimeEnvironmentPanel } from "./RuntimeEnvironmentPanel";
import { SystemAboutPanel } from "./SystemAboutPanel";
import { SoftwareAppearancePanel } from "./SoftwareAppearancePanel";
import { SoftwareStartupPanel } from "./SoftwareStartupPanel";
import { SettingsDesktopGate } from "./SettingsDesktopGate";
import { DataPathsPanel } from "./DataPathsPanel";
import { AdvancedSettingsIntro } from "./AdvancedSettingsIntro";
import { ServiceSettingsSection } from "./ServiceSettingsSection";
import { SettingsSectionFrame } from "./SettingsSectionFrame";
import { SoftwareSettingsSection } from "./SoftwareSettingsSection";
import { LicenseStatusPanel } from "./LicenseStatusPanel";
import { OpenClawDataRootsBanner } from "./OpenClawDataRootsBanner";
import { GatewaySupervisorPanel } from "./GatewaySupervisorPanel";
import { GatewayConnectionSettings } from "./GatewayConnectionSettings";
import { GatewayConfigReadoutPanel } from "./GatewayConfigReadoutPanel";
import { OpenClawOwnerDevSettings } from "./OpenClawOwnerDevSettings";
import { APP_VERSION } from "../../lib/app-version";
import { PRODUCT_NAME } from "../../lib/product-brand";
import { isTauriRuntime } from "../../lib/tauri-env";
import { OwnerUnlockPanel } from "../owner/OwnerUnlockPanel";
import { useOwnerStore } from "../../stores/ownerStore";
import { useUiStore } from "../../stores/uiStore";
import { scrollToSettingsFocus } from "../../lib/settings-focus";
import { settingsFocusToTab, type SettingsTab } from "../../lib/settings-nav";

const MemoOwnerUnlockPanel = memo(OwnerUnlockPanel);

export const GatewaySettings = memo(function GatewaySettings() {
  const ownerUnlocked = useOwnerStore((s) => s.unlocked || Boolean(s.devBypass));
  const settingsFocus = useUiStore((s) => s.settingsFocus);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const runSettingsFocusScroll = useCallback(() => {
    const focus = useUiStore.getState().settingsFocus;
    if (!focus) return;
    scrollToSettingsFocus(focus, ownerUnlocked, () => {
      if (useUiStore.getState().settingsFocus === focus) {
        useUiStore.getState().consumeSettingsFocus();
      }
    }, { onSwitchTab: setActiveTab });
  }, [ownerUnlocked]);

  useEffect(() => {
    if (!settingsFocus) return;
    setActiveTab(settingsFocusToTab(settingsFocus));
    runSettingsFocusScroll();
  }, [settingsFocus, runSettingsFocusScroll]);

  const panels: Record<SettingsTab, ReactNode> = {
    general: (
      <SoftwareSettingsSection>
        <SoftwareAppearancePanel />
        <OutputDirSettingsPanel />
        <SoftwareStartupPanel />
        <AppUpdatePanel />
      </SoftwareSettingsSection>
    ),
    account: (
      <SettingsSectionFrame
        id="account-settings"
        title="账号与授权"
        description="登录密码与设备授权状态。"
      >
        {isTauriRuntime() ? (
          <AccountPasswordSection />
        ) : (
          <SettingsDesktopGate title="修改密码" description="账号密码修改需在桌面客户端中操作。" />
        )}
        <LicenseStatusPanel />
      </SettingsSectionFrame>
    ),
    service: (
      <ServiceSettingsSection>
        {!isTauriRuntime() ? (
          <SettingsDesktopGate
            title="模型密钥"
            description="API Key、模块与知识库助手需在桌面客户端中配置。"
          />
        ) : (
          <>
            <ApiKeySettingsPanel />
            <ModuleManagerPanel />
            <KbAssistantSettingsPanel />
            <CapabilityOpsPanel />
          </>
        )}
      </ServiceSettingsSection>
    ),
    system: (
      <SettingsSectionFrame
        id="system-settings"
        title="系统与环境"
        description="运行环境自检与本机信息。"
      >
        {!isTauriRuntime() ? (
          <SettingsDesktopGate
            title="系统信息"
            description="运行环境检测需在桌面客户端中使用。"
          />
        ) : null}
        <RuntimeEnvironmentPanel />
        <SystemAboutPanel />
      </SettingsSectionFrame>
    ),
    advanced: (
      <SettingsSectionFrame
        id="advanced-settings"
        title="本机服务（高级）"
        description="运行时、监管与连接诊断；Owner 解锁后可改深度配置。"
      >
        {isTauriRuntime() ? (
          <>
            <OpenClawRuntimePanel />
            <GatewaySupervisorPanel />
            <OpenClawDataRootsBanner />
            <GatewayConnectionSettings />
            <DataPathsPanel />
          </>
        ) : (
          <SettingsDesktopGate
            title="本机服务"
            description="运行时与连接诊断需在桌面客户端中使用。"
          />
        )}
        <MemoOwnerUnlockPanel compact onUnlocked={runSettingsFocusScroll} />
        <AdvancedSettingsIntro ownerUnlocked={ownerUnlocked} />
        {ownerUnlocked ? <GatewayConfigReadoutPanel /> : null}
        {ownerUnlocked ? <OpenClawOwnerDevSettings /> : null}
      </SettingsSectionFrame>
    ),
  };

  return (
    <SettingsLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      panels={panels}
      footer={
        <p className="text-center text-[11px] text-[var(--text-muted)]">{PRODUCT_NAME} {APP_VERSION}</p>
      }
    />
  );
});
