import { memo } from "react";
import { PRODUCT_NAME } from "../../lib/product-brand";

type Props = {
  title?: string;
  description?: string;
};

/** 非桌面运行时（浏览器预览）的统一占位，避免设置后几项 tab 空白。 */
export const SettingsDesktopGate = memo(function SettingsDesktopGate({
  title = "桌面版专属",
  description = `以下功能需在 ${PRODUCT_NAME} 桌面客户端中使用。`,
}: Props) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-glass)] p-5 text-center">
      <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
    </div>
  );
});
