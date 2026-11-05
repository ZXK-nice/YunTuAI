import { useEffect, useRef } from "react";
import { getItem, setItem } from "../lib/safeStorage";
import { isTauriRuntime } from "../lib/tauri-env";
import { useUiStore } from "../stores/uiStore";

const FIRST_READY_KEY = "yuntu.first-ready-hint-seen";

/** 首次进入主界面：提示可拖文件与托盘行为。 */
export function useFirstReadyHint() {
  const showToast = useUiStore((s) => s.showToast);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.MODE === "test") return;
    if (shownRef.current || getItem(FIRST_READY_KEY) === "1") return;
    shownRef.current = true;
    setItem(FIRST_READY_KEY, "1");
    showToast(
      "准备完成：可拖入文件处理；关闭窗口会缩到托盘，托盘右键可退出",
      "info",
      {
        label: "打开产出",
        onClick: () => useUiStore.getState().requestNavToOutputs(),
      },
    );
  }, [showToast]);
}
