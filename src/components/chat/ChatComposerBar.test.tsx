import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { ChatComposerBar } from "./ChatComposerBar";

vi.mock("./ModelSelector", () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("./DeepThinkingToggle", () => ({
  DeepThinkingToggle: () => <div data-testid="deep-thinking" />,
}));

describe("ChatComposerBar smoke", () => {
  const baseProps = {
    draft: "",
    onDraftChange: vi.fn(),
    draftRef: createRef<HTMLTextAreaElement>(),
    placeholder: "输入消息…",
    composerDisabled: false,
    sendDisabled: false,
    canAttachFiles: true,
    busy: false,
    voiceListening: false,
    pendingAttachments: [],
    onRemoveAttachment: vi.fn(),
    onAttachFiles: vi.fn(),
    onToggleVoice: vi.fn(),
    onPrimaryAction: vi.fn(),
    fileInputRef: createRef<HTMLInputElement>(),
    onFileInputChange: vi.fn(),
  };

  it("renders composer tools and send button", () => {
    render(<ChatComposerBar {...baseProps} />);
    expect(screen.getByLabelText("添加附件")).toBeTruthy();
    expect(screen.getByLabelText("语音听写")).toBeTruthy();
    expect(screen.getByLabelText("发送消息")).toBeTruthy();
  });

  it("shows local-only shield when enabled", () => {
    render(
      <ChatComposerBar
        {...baseProps}
        localOnlyMode
        onToggleLocalOnly={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("已开启仅本机执行")).toBeTruthy();
  });

  it("lists pending attachment chips", () => {
    render(
      <ChatComposerBar
        {...baseProps}
        draft="hi"
        pendingAttachments={[{ id: "1", name: "data.xlsx" }]}
      />,
    );
    expect(screen.getByLabelText("待发送附件")).toBeTruthy();
    expect(screen.getByText("data.xlsx")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("移除附件 data.xlsx"));
    expect(baseProps.onRemoveAttachment).toHaveBeenCalledWith("1");
  });
});
