import type { SessionsSendAttachment } from "../lib/openclaw/session-rpc";
import type { MessageFileEntry } from "../lib/chat/message-files";

export type SendMessageWorkspaceFile = { displayName: string; content: string };

export type SendMessageInput =
  | string
  | {
      localDisplay: string;
      remotePayload: string;
      workspaceTextFiles?: SendMessageWorkspaceFile[];
      workspaceBatchId?: string;
      attachedFiles?: MessageFileEntry[];
      sendStartedAtMs?: number;
      visionAttachments?: SessionsSendAttachment[];
    };

export type LocalSessionRow = {
  id: string;
  title: string;
  remoteSessionKey: string | null;
  agentId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

export type LocalMessageRow = {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: string;
  displayContent?: string | null;
  sendStatus?: "sending" | "failed";
};

export type MessageListPage = {
  messages: LocalMessageRow[];
  hasMore: boolean;
};

export type SessionSubscriptionHealth = "local_only" | "pending" | "push_ok" | "push_weak";

export type RetryableSend = {
  sessionId: string;
  input: SendMessageInput;
};
