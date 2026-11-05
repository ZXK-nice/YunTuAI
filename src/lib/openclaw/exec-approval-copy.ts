import type { ExecApprovalRequest } from "./exec-approval";

export type ExecApprovalCopy = {
  title: string;
  summary: string;
  detail?: string;
  risky: boolean;
  targetPath?: string;
};

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const seg = norm.split("/").pop();
  return seg?.trim() || path;
}

function pickOutputPath(cmd: string, resolvedPath?: string | null): string | undefined {
  if (resolvedPath?.trim()) return resolvedPath.trim();
  const outPath =
    cmd.match(/(?:-OutPath|OutPath|outpath)\s+["']?([^"'\s]+)["']?/i)?.[1] ??
    cmd.match(/(?:>|>>)\s*["']?([^\s"']+\.(xlsx?|docx?|csv|pptx?|pdf))["']?/i)?.[1];
  return outPath?.trim() || undefined;
}

function officeWriteTarget(cmd: string, resolvedPath?: string | null): string | undefined {
  if (/yuntu-office-write|office-write/i.test(cmd)) {
    return pickOutputPath(cmd, resolvedPath);
  }
  const writeMatch = cmd.match(
    /(?:write|save|export|写入|保存).*?["']([^"']+\.(xlsx?|docx?|csv|pptx?))["']/i,
  );
  return writeMatch?.[1] ?? pickOutputPath(cmd, resolvedPath);
}

function isRiskyCommand(cmd: string): boolean {
  if (/\brm\s+-rf\b|\bformat\s+[a-z]:|del\s+\/[sf]/i.test(cmd)) return true;
  if (/\bnpm\s+install\b|\bpip\s+install\b|\bchoco\s+install\b/i.test(cmd)) return true;
  if (/\breg\s+(add|delete)\b|\bsetacl\b|\btakeown\b/i.test(cmd)) return true;
  if (/\bshutdown\b|\brestart-computer\b|\bstop-process\b.*-force/i.test(cmd)) return true;
  return false;
}

export function describeExecApproval(entry: ExecApprovalRequest): ExecApprovalCopy {
  if (entry.kind === "plugin") {
    const title = entry.pluginTitle ?? entry.request.command;
    return {
      title: "插件操作待确认",
      summary: title,
      detail: entry.pluginDescription?.trim() || undefined,
      risky: entry.pluginSeverity === "critical" || entry.pluginSeverity === "high",
    };
  }

  const cmd = entry.request.command.trim();
  const risky = isRiskyCommand(cmd);
  const target = officeWriteTarget(cmd, entry.request.resolvedPath);
  const fileName = target ? basename(target) : undefined;

  if (fileName && /\.(xlsx?|csv)$/i.test(fileName)) {
    return {
      title: "保存表格结果",
      summary: `要写入结果表格「${fileName}」，允许吗？`,
      detail: "用于把整理后的表格保存到你的产出文件夹。",
      risky,
      targetPath: target,
    };
  }

  if (fileName && /\.docx?$/i.test(fileName)) {
    return {
      title: "保存 Word 文档",
      summary: `要写入 Word 文档「${fileName}」，允许吗？`,
      detail: "用于把生成的文档保存到你的产出文件夹。",
      risky,
      targetPath: target,
    };
  }

  if (fileName && /\.(pptx?|pdf)$/i.test(fileName)) {
    return {
      title: "保存办公文件",
      summary: `要保存文件「${fileName}」，允许吗？`,
      risky,
      targetPath: target,
    };
  }

  if (/yuntu-office-write|office-write\.ps1/i.test(cmd)) {
    return {
      title: "写入办公文件",
      summary: fileName
        ? `要写入办公文件「${fileName}」，允许吗？`
        : "要写入办公结果文件，允许吗？",
      detail: "使用云图内置写回能力，无需安装 Python 或 npm。",
      risky,
      targetPath: target,
    };
  }

  if (/powershell|pwsh/i.test(cmd) && !risky) {
    return {
      title: "本机脚本操作",
      summary: fileName
        ? `要执行本机操作并可能影响「${fileName}」，允许吗？`
        : "要执行一条本机 PowerShell 操作，允许吗？",
      risky,
      targetPath: target,
    };
  }

  if (risky) {
    return {
      title: "高风险命令待确认",
      summary: "该操作可能修改系统或安装外部依赖，请仔细确认后再允许。",
      risky: true,
      targetPath: target,
    };
  }

  return {
    title: "本机操作待确认",
    summary: "要执行一条本机命令完成任务，允许吗？",
    detail: "日常办公写文件类操作通常可点「允许一次」。",
    risky: false,
    targetPath: target,
  };
}
