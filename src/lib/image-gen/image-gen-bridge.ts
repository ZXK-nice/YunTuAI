import { invokeWithAuthRetry } from "../auth-token";
import { isTauriRuntime } from "../tauri-env";

export type ImageGenProvider = "volcengine" | "wcode";

export type ImageGenConfig = {
  configured: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  size: string;
  apiKeyHint?: string | null;
};

export type GeneratedImageItem = {
  id: string;
  name: string;
  path: string;
  size: number;
  prompt: string;
  model: string;
  createdAtMs: number;
  width?: number;
  height?: number;
  mode?: string | null;
  referenceCount?: number | null;
  referencePaths?: string[] | null;
};

export type ImageGenMode = "text" | "image";

/** 生图 API 可能需 10～180 秒，必须长于默认 IPC 10s 超时 */
const IMAGE_GEN_TIMEOUT_MS = 200_000;

export const IMAGE_GEN_PROVIDERS: {
  id: ImageGenProvider;
  label: string;
  hint: string;
  defaultModel: string;
  defaultBaseUrl: string;
}[] = [
  {
    id: "volcengine",
    label: "火山引擎方舟",
    hint: "在 console.volcengine.com 方舟控制台创建 API Key，并开通 Seedream 5.0 模型。",
    defaultModel: "doubao-seedream-5-0-pro-260628",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
  },
  {
    id: "wcode",
    label: "万码云",
    hint: "在 wcode.net/get-apikey 获取 API Key（通常以 apikey- 开头）。",
    defaultModel: "doubao/doubao-seedream-5.0-pro",
    defaultBaseUrl: "https://wcode.net/api/gpt/v1/images/generations",
  },
];

export const IMAGE_GEN_SIZES = ["1K", "2K", "3K", "4K"] as const;
export const IMAGE_GEN_HISTORY_CAP = 48;
export const IMAGE_GEN_MAX_REFERENCES = 3;

async function invokeImageGen<T>(
  cmd: string,
  args: Record<string, unknown> = {},
  timeoutMs = IMAGE_GEN_TIMEOUT_MS,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("作图需在桌面客户端中使用");
  }
  return invokeWithAuthRetry<T>(cmd, args, { timeoutMs, critical: true });
}

export async function fetchImageGenConfig(): Promise<ImageGenConfig | null> {
  if (!isTauriRuntime()) return null;
  return invokeWithAuthRetry<ImageGenConfig>("image_gen_config_cmd", {}, { timeoutMs: 15_000 });
}

export async function saveImageGenConfig(input: {
  provider: ImageGenProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  size?: string;
}): Promise<ImageGenConfig> {
  const saved = await invokeImageGen<ImageGenConfig>("image_gen_save_config_cmd", {
    provider: input.provider,
    apiKey: input.apiKey?.trim() || null,
    baseUrl: input.baseUrl?.trim() || null,
    model: input.model?.trim() || null,
    size: input.size?.trim() || null,
  }, 30_000);
  return saved;
}

export async function useChatApiKeyForImageGen(): Promise<ImageGenConfig> {
  return invokeImageGen<ImageGenConfig>("image_gen_use_chat_api_key_cmd", {}, 30_000);
}

export async function createGeneratedImage(
  prompt: string,
  size?: string,
  referencePaths?: string[],
): Promise<GeneratedImageItem> {
  return invokeImageGen<GeneratedImageItem>("image_gen_create_cmd", {
    prompt,
    size: size || null,
    referencePaths:
      referencePaths && referencePaths.length > 0 ? referencePaths : null,
  });
}

export async function listGeneratedImages(): Promise<GeneratedImageItem[]> {
  if (!isTauriRuntime()) return [];
  const list = await invokeWithAuthRetry<GeneratedImageItem[]>(
    "image_gen_list_cmd",
    {},
    { timeoutMs: 30_000 },
  );
  return list ?? [];
}

export async function deleteGeneratedImage(id: string): Promise<void> {
  await invokeImageGen<void>("image_gen_delete_cmd", { id }, 30_000);
}

export async function testImageGenConnection(): Promise<string> {
  return invokeImageGen<string>("image_gen_test_connection_cmd");
}

export async function revealImageStudioFolder(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invokeWithAuthRetry<string>("image_gen_reveal_folder_cmd", {}, { timeoutMs: 15_000 });
}

export async function pickReferenceImages(): Promise<string[]> {
  if (!isTauriRuntime()) return [];
  const list = await invokeWithAuthRetry<string[]>(
    "image_gen_pick_references_cmd",
    {},
    { timeoutMs: 120_000 },
  );
  return list ?? [];
}

/** 弹出系统另存为对话框，将图片复制到用户选择的位置 */
export async function exportGeneratedImage(path: string): Promise<string | null> {
  return invokeImageGen<string | null>("image_gen_export_cmd", { path }, 60_000);
}

export function providerLabel(id: string): string {
  return IMAGE_GEN_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

export function suggestProviderForApiKey(key: string): ImageGenProvider | null {
  const t = key.trim().toLowerCase();
  if (t.startsWith("apikey-")) return "wcode";
  if (t.startsWith("ark-")) return "volcengine";
  return null;
}
