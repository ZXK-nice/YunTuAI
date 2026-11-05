import type { SettingsFocus } from "../stores/uiStore";

/** 设置页左侧/顶部分栏 */
export type SettingsTab = "general" | "account" | "service" | "system" | "advanced";

export type SettingsNavItem = {
  id: SettingsTab;
  label: string;
  hint: string;
};

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: "general", label: "通用", hint: "外观、启动与更新" },
  { id: "account", label: "账号", hint: "密码与设备授权" },
  { id: "service", label: "模型密钥", hint: "API Key、模块与知识库" },
  { id: "system", label: "系统", hint: "环境与本机信息" },
  { id: "advanced", label: "本机服务", hint: "运行时、连接与 Owner" },
];

export function settingsFocusToTab(focus: SettingsFocus): SettingsTab {
  switch (focus) {
    case "modules":
    case "kb-assistant":
      return "service";
    case "software":
    case "output-dir":
      return "general";
    case "license":
      return "account";
    case "license-issuer":
    case "owner-unlock":
      return "advanced";
    default:
      return "general";
  }
}
