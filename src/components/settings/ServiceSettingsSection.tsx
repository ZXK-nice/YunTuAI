import { memo, type ReactNode } from "react";
import { SettingsSectionFrame } from "./SettingsSectionFrame";

type Props = {
  children: ReactNode;
};

export const ServiceSettingsSection = memo(function ServiceSettingsSection({ children }: Props) {
  return (
    <SettingsSectionFrame
      id="service-settings"
      title="模型与模块"
      description="配置 API Key、可选模块与知识库助手。"
    >
      {children}
    </SettingsSectionFrame>
  );
});
