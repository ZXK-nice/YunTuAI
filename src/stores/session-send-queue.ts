import type { SendMessageInput } from "./session-store-types";

export type QueuedDisconnectedSend = {
  sessionId: string;
  input: SendMessageInput;
  opts?: {
    skipUserAppend?: boolean;
    autoRetryAttempt?: number;
    compactionRetryAttempt?: number;
    idleRetryAttempt?: number;
    templateId?: string;
    taskTitle?: string;
    localOnlyMode?: boolean;
  };
};

let queued: QueuedDisconnectedSend | null = null;

export function enqueueDisconnectedSend(item: QueuedDisconnectedSend): void {
  queued = item;
}

export function peekQueuedDisconnectedSend(): QueuedDisconnectedSend | null {
  return queued;
}

export function takeQueuedDisconnectedSend(): QueuedDisconnectedSend | null {
  const item = queued;
  queued = null;
  return item;
}

export function clearQueuedDisconnectedSend(): void {
  queued = null;
}

export function hasQueuedDisconnectedSend(): boolean {
  return queued != null;
}
