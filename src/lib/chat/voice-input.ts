/** 聊天语音听写：麦克风预检 + Web Speech API 错误文案 */

import { PRODUCT_NAME } from "../product-brand";

export type VoiceInputReady =
  | { ok: true }
  | { ok: false; message: string; hint: string };

const MIC_CACHE_MS = 10 * 60 * 1000;
let micReadyCache: { at: number } | null = null;

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
}

export function getSpeechRecognitionCtor():
  | (new () => WebSpeechReco)
  | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function describeSpeechRecognitionError(code: string): { message: string; hint?: string } {
  switch (code.trim().toLowerCase()) {
    case "not-allowed":
    case "service-not-allowed":
      return {
        message: "麦克风未授权",
        hint: `Windows：设置 → 隐私和安全性 → 麦克风 → 开启并允许 ${PRODUCT_NAME}。`,
      };
    case "no-speech":
      return {
        message: "未检测到语音",
        hint: "请靠近麦克风说话，或检查系统默认录音设备。",
      };
    case "audio-capture":
      return {
        message: "无法采集音频",
        hint: "麦克风可能被其他软件占用，请关闭会议/录音软件后重试。",
      };
    case "network":
      return {
        message: "在线听写不可用",
        hint: "桌面客户端无法使用浏览器在线识别（与本机服务是否已连接无关）。请改用键盘输入，会议请用实时录制的本机转写。",
      };
    case "aborted":
      return { message: "听写已取消" };
    case "language-not-supported":
      return {
        message: "当前语言不受支持",
        hint: "已使用 zh-CN；若仍失败请改用键盘输入。",
      };
    default:
      return {
        message: code ? `听写失败（${code}）` : "听写失败",
        hint: "请检查麦克风权限与网络，或稍后重试。",
      };
  }
}

function micAccessHint(name: string): VoiceInputReady {
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return {
      ok: false,
      message: "麦克风权限被拒绝",
      hint: `Windows：设置 → 隐私和安全性 → 麦克风 → 允许 ${PRODUCT_NAME} 访问。`,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      ok: false,
      message: "未检测到可用麦克风",
      hint: "请连接耳机麦克风或检查系统「声音 → 输入」中的默认设备。",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      ok: false,
      message: "麦克风被占用或无法打开",
      hint: "请关闭正在使用麦克风的应用（会议、录屏等）后重试。",
    };
  }
  return {
    ok: false,
    message: "无法访问麦克风",
    hint: "请检查系统录音设备与隐私设置。",
  };
}

/** 启动听写前：检查麦克风权限（成功结果短期缓存，避免重复弹窗）。 */
export async function ensureVoiceInputReady(options?: {
  skipCache?: boolean;
  /** 聊天听写需要 Web Speech；会议实时转写走本机 ASR，不依赖该 API。 */
  requireSpeechApi?: boolean;
}): Promise<VoiceInputReady> {
  if (options?.requireSpeechApi !== false && !isSpeechRecognitionSupported()) {
    return {
      ok: false,
      message: "当前环境不支持语音听写",
      hint: `请使用 ${PRODUCT_NAME} 桌面版；部分浏览器预览模式无 Web Speech API。`,
    };
  }
  if (!options?.skipCache && micReadyCache && Date.now() - micReadyCache.at < MIC_CACHE_MS) {
    return { ok: true };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      message: "无法检测麦克风",
      hint: "当前运行环境未提供麦克风 API，请使用桌面版重试。",
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    micReadyCache = { at: Date.now() };
    return { ok: true };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    return micAccessHint(name);
  }
}

export function clearVoiceInputMicCache(): void {
  micReadyCache = null;
}

export function formatVoiceInputToast(result: VoiceInputReady & { ok: false }): string {
  return result.hint ? `${result.message}\n${result.hint}` : result.message;
}

export type SpeechSession = {
  stop: () => void;
};

export type SpeechSessionOptions = {
  lang?: string;
  onFinalText: (text: string) => void;
  onInterimText?: (text: string) => void;
  onError: (code: string) => void;
  onEnd: () => void;
};

/** 创建听写会话（调用方需在卸载时 stop）。 */
export function startSpeechSession(options: SpeechSessionOptions): SpeechSession | null {
  const ctor = getSpeechRecognitionCtor();
  if (!ctor) return null;

  const r = new ctor();
  r.lang = options.lang ?? "zh-CN";
  r.continuous = true;
  r.interimResults = Boolean(options.onInterimText);

  r.onresult = (ev: WebSpeechRecoEvent) => {
    let interim = "";
    let final = "";
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const line = ev.results[i];
      const text = line?.[0]?.transcript ?? "";
      const isFinal = Boolean((line as { isFinal?: boolean } | undefined)?.isFinal);
      if (isFinal) final += text;
      else interim += text;
    }
    if (interim && options.onInterimText) options.onInterimText(interim);
    if (final) options.onFinalText(final);
  };

  r.onerror = ((ev: { error?: string }) => {
    options.onError(ev.error?.trim() || "unknown");
  }) as WebSpeechReco["onerror"];

  r.onend = () => {
    options.onEnd();
  };

  try {
    r.start();
    return { stop: () => r.stop() };
  } catch {
    return null;
  }
}
