import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyColorScheme, readStoredColorScheme } from "./lib/theme";
import { applyHeaderNavModeCss, applySidebarWidthCss, readHeaderNavMode, readSidebarExpanded } from "./lib/layout-prefs";
import { installGlobalErrorHandlers } from "./lib/setup-global-handlers";
import { clearBootSplash } from "./lib/clear-boot-splash";
import { isTauriRuntime } from "./lib/tauri-env";
import "./index.css";

applyColorScheme(readStoredColorScheme());
applySidebarWidthCss(readSidebarExpanded());
applyHeaderNavModeCss(readHeaderNavMode());
installGlobalErrorHandlers();

const app = <App />;

/* Tauri 桌面端禁用 StrictMode：开发模式下双挂载会让 bootstrap/网关连接跑两遍，IPC 堵死整窗。 */
const useStrictMode = import.meta.env.DEV && !isTauriRuntime();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  useStrictMode ? <React.StrictMode>{app}</React.StrictMode> : app,
);
clearBootSplash();
