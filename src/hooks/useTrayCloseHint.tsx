import { useCallback, useState } from "react";
import { getItem, setItem } from "../lib/safeStorage";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";

const TRAY_HINT_KEY = "yuntu.tray-close-hint-seen";

/** 首次关闭主窗口时说明托盘行为（配合标题栏关闭与系统 X）。 */
export function useTrayCloseHint() {
  const [open, setOpen] = useState(false);

  const maybeShowTrayCloseHint = useCallback(() => {
    if (getItem(TRAY_HINT_KEY) === "1") return false;
    setOpen(true);
    return true;
  }, []);

  const onAck = useCallback(() => {
    setItem(TRAY_HINT_KEY, "1");
    setOpen(false);
  }, []);

  const TrayCloseHintDialog = (
    <ConfirmDialog
      open={open}
      title="窗口已缩到托盘"
      titleId="yuntu-tray-close-hint-title"
      confirmLabel="知道了"
      hideCancel
      onClose={onAck}
      onConfirm={onAck}
    >
      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
        关闭窗口不会退出云图，任务可在后台继续。要彻底退出，请点系统托盘图标右键，选择「退出 YunTuAI」。
      </p>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        左键单击托盘图标可重新打开主界面。
      </p>
    </ConfirmDialog>
  );

  return { maybeShowTrayCloseHint, TrayCloseHintDialog };
}
