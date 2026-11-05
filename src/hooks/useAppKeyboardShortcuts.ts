import { useEffect } from "react";
import type { NavKey } from "../types/app-nav";
import { connectWithFeedback } from "../lib/connect-with-feedback";
import { useGatewayStore } from "../stores/gatewayStore";
import { useSessionStore } from "../stores/sessionStore";

type Options = {
  onNav: (k: NavKey) => void;
  onFocusChat?: () => void;
};

export function useAppKeyboardShortcuts({ onNav, onFocusChat }: Options) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === "n") {
        e.preventDefault();
        useSessionStore.getState().enterComposeMode();
        onFocusChat?.();
        return;
      }

      if (key === "r" && e.shiftKey) {
        e.preventDefault();
        const conn = useGatewayStore.getState().connState;
        if (conn === "disconnected" || conn === "error") {
          void connectWithFeedback("重连");
        }
        return;
      }

      if (key === "s" && e.shiftKey) {
        e.preventDefault();
        void useSessionStore.getState().syncRemoteForActive();
        return;
      }

      if (key === ",") {
        e.preventDefault();
        onNav("settings");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNav, onFocusChat]);
}
