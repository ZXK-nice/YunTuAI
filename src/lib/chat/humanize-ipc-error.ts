/** 将 Rust/IPC 底层英文错误转为用户可读的简短中文（toast / 气泡用）。 */
export function humanizeIpcError(raw: string): string {
  const msg = raw.trim();
  if (!msg) return "操作失败，请重试";
  if (/permission|access denied|eacces/i.test(msg)) return "无权限访问该文件";
  if (/not found|enoent|找不到/i.test(msg)) return "文件不存在或已被移动";
  if (/timeout|timed out|超时/i.test(msg)) return "操作超时，请稍后重试";
  if (/ocr|tesseract|tessdata/i.test(msg)) return "内置 OCR 暂不可用";
  if (/gateway|websocket|连接|18789/i.test(msg)) return "本机服务连接异常，请检查本机服务状态";
  if (/owner|未配置/i.test(msg)) return msg;
  if (/[\u4e00-\u9fff]/.test(msg)) return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
  return "操作失败，请重试或查看日志";
}
