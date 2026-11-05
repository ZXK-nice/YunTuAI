import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";

vi.mock("../../lib/chat/use-tauri-file-drop", () => ({
  useTauriFileDrop: vi.fn(),
}));

vi.mock("../../lib/gsap/setup", () => ({
  prefersReducedMotion: () => true,
}));

vi.mock("../../lib/connect-with-feedback", () => ({
  connectWithFeedback: vi.fn(),
}));

vi.mock("../../hooks/useConnectionDiagnostics", () => ({
  compactActiveSessionForUi: vi.fn(async () => undefined),
}));

vi.mock("../../lib/chat/chat-files-bridge", () => ({
  chatGetOutputDir: vi.fn(async () => "/tmp"),
  chatInspectDroppedPaths: vi.fn(async () => []),
  inspectedToPendingAttachments: vi.fn(() => []),
}));

vi.mock("../motion/ChatEmptyHeroMotion", () => ({
  ChatEmptyHeroMotion: ({ children }: { children: React.ReactNode }) => <div data-testid="empty-hero">{children}</div>,
}));

vi.mock("../motion/ComposerDockMotion", () => ({
  ComposerDockMotion: ({ children }: { children: React.ReactNode }) => <div data-testid="composer-dock">{children}</div>,
}));

vi.mock("./ChatMessageList", () => ({
  ChatMessageList: () => <div data-testid="message-list" />,
}));

vi.mock("./ChatStreamingBubble", () => ({
  ChatStreamingBubble: () => null,
}));

vi.mock("./ModelSelector", () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("./DeepThinkingToggle", () => ({
  DeepThinkingToggle: () => null,
}));

const sessionState = {
  activeId: null as string | null,
  sessions: [] as { id: string; title?: string; remoteSessionKey?: string }[],
  messagesBySession: {} as Record<string, unknown[]>,
  hasMoreBySession: {} as Record<string, boolean>,
  loadingOlderBySession: {} as Record<string, boolean>,
  loadingMessagesBySession: {} as Record<string, boolean>,
  isSending: false,
  queuedSendPending: false,
  sendingSessionId: null as string | null,
  lastRetryableSend: null,
  sendProgressLabel: null as string | null,
  loadOlderMessages: vi.fn(),
  createSession: vi.fn(),
  sendMessage: vi.fn(),
  abortActiveSend: vi.fn(),
  deleteMessage: vi.fn(),
  retryLastSend: vi.fn(),
  dismissRetryableSend: vi.fn(),
  summarizeAndContinueInNewChat: vi.fn(),
};

const gatewayState = {
  connState: "connected" as string,
  lastError: null as string | null,
  startupPhase: null as string | null,
};

vi.mock("../../stores/sessionStore", () => ({
  useSessionStore: Object.assign(
    (sel?: (s: typeof sessionState) => unknown) => (sel ? sel(sessionState) : sessionState),
    { getState: () => sessionState, setState: vi.fn() },
  ),
}));

vi.mock("../../stores/gatewayStore", () => ({
  useGatewayStore: Object.assign(
    (sel?: (s: typeof gatewayState) => unknown) => (sel ? sel(gatewayState) : gatewayState),
    { getState: () => gatewayState, setState: vi.fn() },
  ),
}));

vi.mock("../../stores/uiStore", () => ({
  useUiStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        showToast: vi.fn(),
        chatCollapsed: false,
        toggleChatCollapsed: vi.fn(),
        composerDrafts: {},
        setComposerDraft: vi.fn(),
        pendingComposerLine: null,
        pendingChatContext: null,
        composeResetTick: 0,
        requestOpenModelSelector: vi.fn(),
      };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ showToast: vi.fn() }), setState: vi.fn() },
  ),
}));

vi.mock("../../stores/agentStore", () => ({
  useAgentStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const state = { agents: [], activeAgentId: null };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ agents: [], activeAgentId: null }) },
  ),
}));

vi.mock("../../stores/stepStore", () => ({
  useStepStore: Object.assign(
    (sel?: (s: { steps: unknown[] }) => unknown) => {
      const state = { steps: [] };
      return sel ? sel(state) : state;
    },
    { getState: () => ({ steps: [] }) },
  ),
}));

describe("ChatPanel smoke", () => {
  beforeEach(() => {
    sessionState.activeId = null;
    sessionState.sessions = [];
    sessionState.messagesBySession = {};
    sessionState.isSending = false;
    sessionState.queuedSendPending = false;
    sessionState.sendingSessionId = null;
    sessionState.sendProgressLabel = null;
    sessionState.lastRetryableSend = null;
    gatewayState.connState = "connected";
    gatewayState.lastError = null;
    gatewayState.startupPhase = null;
  });

  it("renders message log and composer controls in empty state", () => {
    render(<ChatPanel />);
    expect(screen.getByRole("log", { name: "消息" })).toBeTruthy();
    expect(screen.getByLabelText("添加附件")).toBeTruthy();
    expect(screen.getByLabelText("发送消息")).toBeTruthy();
  });

  it("renders quick-start templates when connected with no messages", () => {
    render(<ChatPanel />);
    expect(screen.getByTestId("empty-hero")).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(2);
  });

  it("disables send with a reason when another session is generating", () => {
    sessionState.activeId = "s1";
    sessionState.sessions = [{ id: "s1", title: "本会话", remoteSessionKey: "k1" }];
    sessionState.messagesBySession = { s1: [] };
    sessionState.isSending = true;
    sessionState.sendingSessionId = "s2";
    render(<ChatPanel />);
    const send = screen.getByLabelText("发送消息");
    expect(send).toBeDisabled();
    expect(send.getAttribute("title")).toContain("另一会话正在生成回复");
  });

  it("humanizes reconnect banner copy", () => {
    gatewayState.connState = "error";
    gatewayState.lastError = "connect ECONNREFUSED 127.0.0.1:18789";
    render(<ChatPanel />);
    expect(screen.getByRole("alert").textContent).toContain("本机服务未就绪");
  });

  it("keeps send enabled while disconnected so the message can queue", () => {
    sessionState.activeId = "s1";
    sessionState.sessions = [{ id: "s1", title: "本会话", remoteSessionKey: "k1" }];
    sessionState.messagesBySession = { s1: [] };
    gatewayState.connState = "disconnected";
    render(<ChatPanel />);
    fireEvent.change(screen.getByLabelText("消息输入框"), { target: { value: "你好" } });
    const send = screen.getByLabelText("发送消息");
    expect(send).not.toBeDisabled();
    expect(send.getAttribute("title") ?? "").not.toContain("请先连接");
  });
});
