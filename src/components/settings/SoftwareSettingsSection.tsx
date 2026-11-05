import { memo, type ReactNode } from "react";
import { SettingsSectionFrame } from "./SettingsSectionFrame";

type Props = {
  children: ReactNode;
};

export const SoftwareSettingsSection = memo(function SoftwareSettingsSection({ children }: Props) {
  return (
    <SettingsSectionFrame
      id="software-settings"
      title="软件设置"
      description="应用更新、账号、外观、开机自启与设备授权状态。"
    >
      {children}
    </SettingsSectionFrame>
  );
});
