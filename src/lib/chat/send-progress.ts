/** 发送链路各阶段的用户可见文案（ChatPanel 预处理 + sessionStore.sendMessage）。 */
export const SEND_PROGRESS = {
  WAITING_GATEWAY: "正在连接本机服务…",
  SAVING_ATTACHMENTS: "正在保存附件…",
  EXTRACTING_DOCS: "正在提取文档内容…",
  RECOGNIZING_IMAGES: "正在识别图片文字…",
  BINDING_SESSION: "正在连接办事会话…",
  SYNCING_CHANNEL: "正在同步消息通道…",
  COMPACTING_CONTEXT: "正在压缩长对话上下文…",
  WRITING_WORKSPACE: "正在写入工作区…",
  SUBMITTING: "正在提交任务…",
  EXECUTING: "正在执行，请稍候…",
} as const;

export type SendProgressLabel = (typeof SEND_PROGRESS)[keyof typeof SEND_PROGRESS];
