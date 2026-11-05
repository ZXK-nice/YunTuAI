/**
 * OpenClaw Agent 单轮运行超时（`agents.defaults.timeoutSeconds`）与
 * provider 级 model idle timeout（`models.providers.*.timeoutSeconds`）。
 * 与前端 SEND_HARD_CAP_MS（2h 无活动硬顶）对齐，避免网关先杀、客户端仍显示「服务断开」。
 */
export const AGENT_RUN_TIMEOUT_SECONDS = 2 * 60 * 60;

const AGENT_RUN_TIMEOUT_RE =
  /chat run timed out|request timed out before a response|agents\.defaults\.timeoutseconds|timeoutseconds.*in your config|prompt timed out|prompt timeout|timedout.*prompt/i;

const MODEL_IDLE_TIMEOUT_RE =
  /llm request timed out|model idle timeout|models\.providers\.\w+\.timeoutseconds/i;

export function isModelIdleTimeoutError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return MODEL_IDLE_TIMEOUT_RE.test(m);
}

export function isAgentRunTimeoutError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return AGENT_RUN_TIMEOUT_RE.test(m) || MODEL_IDLE_TIMEOUT_RE.test(m);
}

export function humanizeAgentRunTimeoutError(): string {
  const hours = AGENT_RUN_TIMEOUT_SECONDS / 3600;
  return `本机 Agent 单轮执行已超过 ${hours} 小时上限而暂停。若右侧任务进度显示已有产出，请到 output 目录查看；点击「重试发送」可续收尾（不会重复保存用户消息）。`;
}

export function humanizeModelIdleTimeoutError(): string {
  return "任务含多步工具调用（如读 Excel），模型等待间隙过长已超时。请缩小文件范围后重试；表格类附件现已支持本地预提取，升级后一般无需 Agent 自行解压。";
}

export function humanizeGatewayTimeoutError(message: string): string {
  if (MODEL_IDLE_TIMEOUT_RE.test(message)) {
    return humanizeModelIdleTimeoutError();
  }
  if (AGENT_RUN_TIMEOUT_RE.test(message)) {
    return humanizeAgentRunTimeoutError();
  }
  if (/prompt timed out|prompt timeout/i.test(message)) {
    return "本机 Agent 单轮执行超时（多为任务步骤过多或上下文过大）。已尽量保留已输出内容；发送「继续」可续收尾。";
  }
  return message;
}

export const SEND_ABORT_DISCONNECT_BANNER =
  "发送时与本机服务连接中断，可点击重试发送。";

export const ASSISTANT_DISCONNECT_NOTICE =
  "【连接中断】与本机服务的连接已断开，本轮发送已暂停。任务可能在后台继续；重连后将自动同步结果。可点击「重试发送」续作。";

export const SEND_ABORT_GATEWAY_ERROR_BANNER =
  "任务执行中出现错误，可点击重试发送。";

export const SEND_ABORT_USER_BANNER = "已停止本轮生成。已保留已输出内容。";

export const ASSISTANT_RUN_TIMEOUT_NOTICE =
  "【任务执行超时】Agent 单轮运行已达时间上限，已暂停等待。若已有文件写入 output 目录，可先验收；点击「重试发送」可继续收尾。";

export const ASSISTANT_MODEL_IDLE_TIMEOUT_NOTICE =
  "【任务执行超时】多步工具调用间隙过长，模型已暂停。请缩小附件或拆分问题后重试发送。";
