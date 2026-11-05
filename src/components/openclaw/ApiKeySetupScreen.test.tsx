import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiKeySetupScreen } from "./ApiKeySetupScreen";
import {
  DASHSCOPE_API_KEY_ID,
  DEEPSEEK_API_KEY_ID,
  MIMO_API_KEY_ID,
  MODEL_PROVIDER_KEY_SETUP_HINT,
} from "../../lib/openclaw/api-key-policy";

vi.mock("../../hooks/useAppLogo", () => ({
  useAppLogo: () => "/logo.png",
}));

vi.mock("../../lib/openclaw/user-llm-bridge", () => ({
  fetchLlmPresets: vi.fn(async () => []),
  fetchLlmSlots: vi.fn(async () => []),
  saveLlmSlot: vi.fn(),
  clearLlmSlot: vi.fn(),
  slotToCatalogModel: vi.fn(() => null),
}));

const keys = [
  {
    id: MIMO_API_KEY_ID,
    label: "小米 MiMo API Key",
    hint: "mimo.mi.com",
    configured: false,
    required: false,
  },
  {
    id: DEEPSEEK_API_KEY_ID,
    label: "DeepSeek API Key",
    hint: "",
    configured: false,
    required: false,
  },
  {
    id: DASHSCOPE_API_KEY_ID,
    label: "DashScope API Key",
    hint: "",
    configured: false,
    required: false,
  },
];

function pickVendor(id: string) {
  fireEvent.change(screen.getByLabelText("厂商"), { target: { value: id } });
}

function fillApiKey(value: string) {
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value } });
}

describe("ApiKeySetupScreen", () => {
  it("未填任何密钥时提示至少一家", async () => {
    render(
      <ApiKeySetupScreen keys={keys} envPath="C:\\data\\.env" busy={false} onSave={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() => {
      expect(screen.getByText(MODEL_PROVIDER_KEY_SETUP_HINT)).toBeInTheDocument();
    });
  });

  it("仅填 DeepSeek 可通过校验", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <ApiKeySetupScreen keys={keys} envPath="C:\\data\\.env" busy={false} onSave={onSave} />,
    );
    fillApiKey("sk-test-key");
    fireEvent.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ DEEPSEEK_API_KEY: "sk-test-key" });
    });
  });

  it("切换到千问后可填写", async () => {
    render(
      <ApiKeySetupScreen keys={keys} envPath="C:\\data\\.env" busy={false} onSave={vi.fn()} />,
    );
    pickVendor(DASHSCOPE_API_KEY_ID);
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
  });

  it("填写 MiMo Key 后保存成功", async () => {
    const onSave = vi.fn(async () => undefined);
    render(
      <ApiKeySetupScreen keys={keys} envPath="C:\\data\\.env" busy={false} onSave={onSave} />,
    );
    pickVendor(MIMO_API_KEY_ID);
    await waitFor(() => expect(screen.getByLabelText("厂商")).toHaveValue(MIMO_API_KEY_ID));
    fillApiKey("sk-mimo-key");
    fireEvent.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ MIMO_API_KEY: "sk-mimo-key" });
    });
  });

  it("保存失败展示错误", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("写入失败");
    });
    render(
      <ApiKeySetupScreen keys={keys} envPath="C:\\data\\.env" busy={false} onSave={onSave} />,
    );
    pickVendor(MIMO_API_KEY_ID);
    await waitFor(() => expect(screen.getByLabelText("厂商")).toHaveValue(MIMO_API_KEY_ID));
    fillApiKey("sk-mimo-key");
    fireEvent.click(screen.getByRole("button", { name: /保存并继续/ }));
    await waitFor(() => {
      expect(screen.getByText("写入失败")).toBeInTheDocument();
    });
  });
});
