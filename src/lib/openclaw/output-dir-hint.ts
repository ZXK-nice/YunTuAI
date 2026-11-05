const OUTPUT_MARKER = "【输出目录】";

/** 在远程 payload 中注入用户指定产出路径（避免 Agent 只写 workspace 默认 output）。 */
export function appendOutputDirHint(payload: string, outputDir: string | null | undefined): string {
  const dir = outputDir?.trim();
  if (!dir) return payload;
  if (payload.includes(dir) || payload.includes(OUTPUT_MARKER)) return payload;
  return `${payload.trimEnd()}\n\n---\n${OUTPUT_MARKER}所有最终产出文件必须保存到（勿写到其他目录）：\n${dir}\n（工作区内请使用相对路径 output/，已与该目录同步）`;
}
