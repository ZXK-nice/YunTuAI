/** 办公场景下自动拒绝的包安装命令（与 OFFICE_EXECUTION_CONTRACT 一致）。 */

const PACKAGE_INSTALL_RE =
  /\b(pip3?|pipx)\s+install\b|\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci)\b|\bconda\s+install\b|\bpoetry\s+add\b/i;

export type PackageInstallBlock = {
  blocked: true;
  reason: string;
};

export function checkBlockedPackageInstall(command: string): PackageInstallBlock | null {
  const cmd = command.trim();
  if (!cmd) return null;
  if (!PACKAGE_INSTALL_RE.test(cmd)) return null;
  return {
    blocked: true,
    reason:
      "云图已内置办公预提取与写回能力，禁止通过 pip/npm 安装依赖。请使用消息中的预提取文本；表格/文档请在回复末尾用 yuntu-office-write 围栏写回。",
  };
}
