import { useAuthStore } from "../stores/authStore";
import { useGatewayStore } from "../stores/gatewayStore";
import { useOwnerStore } from "../stores/ownerStore";
import { awaitActiveSendSettlement } from "../stores/session-send-active";
import { useSessionStore } from "../stores/sessionStore";
import { useTaskStore } from "../stores/taskStore";
import { useStepStore } from "../stores/stepStore";
import { useWorkspaceArtifactStore } from "../stores/workspaceArtifactStore";
import { resetChatEventDedupState } from "./openclaw/apply-chat-final-event";
import { resetTaskDeliveryState } from "./openclaw/task-delivery";

/** 登出 / 自动锁屏：中止发送、断开网关、清空会话内存、重置流式去重状态。 */
export async function performAppLogout(): Promise<void> {
  useSessionStore.getState().abortActiveSend();
  await awaitActiveSendSettlement();
  useGatewayStore.getState().cancelReconnect();
  useGatewayStore.getState().disconnect();
  useSessionStore.getState().resetForLogout();
  useTaskStore.getState().resetForLogout();
  useStepStore.getState().clear();
  useWorkspaceArtifactStore.getState().clearAll();
  resetTaskDeliveryState();
  resetChatEventDedupState();
  useOwnerStore.getState().reset();
  await useAuthStore.getState().logout();
}
