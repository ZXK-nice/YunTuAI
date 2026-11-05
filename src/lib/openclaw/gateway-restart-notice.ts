import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";

/** 网关即将重启时在聊天场景给出可理解的提示（对话已落库，勿恐慌）。 */
export function notifyGatewayRestartPending(reason: string): void {
  const trimmed = reason.trim() || "维护";
  const sending = useSessionStore.getState().isSending;
  const msg = sending
    ? `本机服务即将重启（${trimmed}）。当前任务会尽量在后台完成，已发送内容已保存。`
    : `本机服务即将重启（${trimmed}），对话已保存；完成后将自动重连。`;
  useUiStore.getState().showToast(msg, "info");
}
