import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  clearVoiceInputMicCache,
  describeSpeechRecognitionError,
  ensureVoiceInputReady,
  formatVoiceInputToast,
  startSpeechSession,
} from "../../lib/chat/voice-input";

type ToastFn = (message: string, variant: "info" | "warning" | "error" | "success") => void;

export function useChatVoiceInput(opts: {
  composerDisabled: boolean;
  showToast: ToastFn;
  setDraft: Dispatch<SetStateAction<string>>;
}) {
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceChecking, setVoiceChecking] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState("");
  const speechRecRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    return () => {
      speechRecRef.current?.stop();
      speechRecRef.current = null;
    };
  }, []);

  const toggleVoiceInput = useCallback(async () => {
    if (opts.composerDisabled || voiceChecking) return;
    if (voiceListening) {
      speechRecRef.current?.stop();
      speechRecRef.current = null;
      setVoiceListening(false);
      setVoiceInterim("");
      return;
    }

    setVoiceChecking(true);
    const ready = await ensureVoiceInputReady();
    setVoiceChecking(false);
    if (!ready.ok) {
      opts.showToast(formatVoiceInputToast(ready), "error");
      return;
    }

    const session = startSpeechSession({
      onFinalText: (text) => {
        if (text) {
          opts.setDraft((d) => d + text);
          setVoiceInterim("");
        }
      },
      onInterimText: (text) => setVoiceInterim(text),
      onError: (code) => {
        if (code === "aborted") return;
        const { message, hint } = describeSpeechRecognitionError(code);
        opts.showToast(hint ? `${message}\n${hint}` : message, "error");
        if (code === "not-allowed" || code === "service-not-allowed") {
          clearVoiceInputMicCache();
        }
      },
      onEnd: () => {
        setVoiceListening(false);
        setVoiceInterim("");
        speechRecRef.current = null;
      },
    });

    if (!session) {
      opts.showToast("无法启动听写，请稍后重试", "error");
      return;
    }

    speechRecRef.current = session;
    setVoiceListening(true);
  }, [opts, voiceChecking, voiceListening]);

  return {
    voiceListening,
    voiceChecking,
    voiceInterim,
    toggleVoiceInput,
  };
}
