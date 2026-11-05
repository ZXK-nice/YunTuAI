import { useEffect, useRef } from "react";
import { isTauriRuntime } from "../tauri-env";

type Options = {
  enabled: boolean;
  onPaths: (paths: string[]) => void;
  onHoverChange?: (hovering: boolean) => void;
};

/** Tauri 桌面端原生文件拖放（Windows WebView 不支持 HTML5 文件 drop）。 */
export function useTauriFileDrop({ enabled, onPaths, onHoverChange }: Options) {
  const onPathsRef = useRef(onPaths);
  const onHoverRef = useRef(onHoverChange);
  onPathsRef.current = onPaths;
  onHoverRef.current = onHoverChange;

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        if (cancelled) return;
        unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "over") {
            onHoverRef.current?.(true);
          } else if (payload.type === "drop") {
            onHoverRef.current?.(false);
            if (payload.paths?.length) onPathsRef.current(payload.paths);
          } else {
            onHoverRef.current?.(false);
          }
        });
      } catch {
        /* 浏览器预览或旧版运行时 */
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      onHoverRef.current?.(false);
    };
  }, [enabled]);
}
