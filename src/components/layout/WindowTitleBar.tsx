import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { useTrayCloseHint } from "../../hooks/useTrayCloseHint";

function IconMinimize() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
    </svg>
  );
}

function IconMaximize() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden>
      <path d="M2 2l8 8M10 2 2 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function WindowTitleBarInner() {
  const win = getCurrentWindow();
  const { maybeShowTrayCloseHint, TrayCloseHintDialog } = useTrayCloseHint();

  const minimize = useCallback(() => {
    void win.minimize();
  }, [win]);

  const toggleMaximize = useCallback(() => {
    void win.isMaximized().then((max) => {
      if (max) void win.unmaximize();
      else void win.maximize();
    });
  }, [win]);

  const close = useCallback(() => {
    maybeShowTrayCloseHint();
    void win.hide();
  }, [maybeShowTrayCloseHint, win]);

  return (
    <>
      <header className="app-window-titlebar">
      <div className="app-window-titlebar__sidebar" data-tauri-drag-region aria-hidden />
      <div className="app-window-titlebar__main">
        <div className="app-window-titlebar__drag" data-tauri-drag-region aria-hidden />
        <div className="app-window-titlebar__controls">
        <button type="button" className="app-window-titlebar__btn" onClick={minimize} aria-label="最小化">
          <IconMinimize />
        </button>
        <button type="button" className="app-window-titlebar__btn" onClick={toggleMaximize} aria-label="最大化">
          <IconMaximize />
        </button>
        <button
          type="button"
          className="app-window-titlebar__btn app-window-titlebar__btn--close"
          onClick={close}
          aria-label="关闭"
        >
          <IconClose />
        </button>
      </div>
      </div>
    </header>
    {TrayCloseHintDialog}
    </>
  );
}

/** 无边框窗口顶栏：无 logo，背景与主界面一致，可拖拽。 */
export function WindowTitleBar() {
  if (!isTauri()) return null;
  return <WindowTitleBarInner />;
}
