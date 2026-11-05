import { memo, useEffect, useState } from "react";
import {
  persistDeepThinkingEnabled,
  readDeepThinkingEnabled,
  shouldOfferDeepThinkingToggle,
} from "../../lib/openclaw/session-thinking";
import { useModelStore } from "../../stores/modelStore";

function IconSpark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.2 9.1 5.5 13.4 6.6 9.1 7.7 8 12 6.9 7.7 2.6 6.6 6.9 5.5 8 1.2Z" />
    </svg>
  );
}

/** 中心四角星 + 开启时扫描环与流动光点。 */
function DeepThinkingPulseIcon({ active }: { active: boolean }) {
  return (
    <span
      className={[
        "deep-thinking-icon",
        active ? "deep-thinking-icon--active" : "",
      ].join(" ")}
      aria-hidden
    >
      <span className="deep-thinking-icon__radar" />
      <span className="deep-thinking-icon__dot" />
      <span className="deep-thinking-icon__dot" />
      <span className="deep-thinking-icon__dot" />
      <IconSpark className="deep-thinking-icon__spark" />
    </span>
  );
}

type Props = {
  disabled?: boolean;
};

/** 对话栏「深度思考」开关（四角星 + 扫描环/光点动效）。 */
export const DeepThinkingToggle = memo(function DeepThinkingToggle({ disabled }: Props) {
  const selectionId = useModelStore((s) => s.selectionId);
  const [visible, setVisible] = useState(false);
  const [enabled, setEnabled] = useState(() => readDeepThinkingEnabled());

  useEffect(() => {
    let cancelled = false;
    void shouldOfferDeepThinkingToggle().then((ok) => {
      if (!cancelled) setVisible(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [selectionId]);

  if (!visible) return null;

  const onToggle = () => {
    const next = !enabled;
    setEnabled(next);
    persistDeepThinkingEnabled(next);
  };

  return (
    <button
      type="button"
      className={[
        "chat-composer-tool-btn deep-thinking-tool-btn",
        enabled ? "chat-composer-tool-btn--active deep-thinking-tool-btn--on" : "",
        disabled ? "opacity-50" : "",
      ].join(" ")}
      title={
        enabled
          ? "深度思考已开启：先推理再回答，更慢但更准"
          : "深度思考已关闭：更快、更省 token"
      }
      aria-label={enabled ? "关闭深度思考" : "开启深度思考"}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={onToggle}
    >
      <DeepThinkingPulseIcon active={enabled} />
    </button>
  );
});
