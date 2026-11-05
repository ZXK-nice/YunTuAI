import { useRef, type ReactNode } from "react";
import { gsap, gsapReveal, prefersReducedMotion, useGSAP } from "../../lib/gsap/setup";

type Props = {
  children: ReactNode;
  visible: boolean;
  /** 每次沉底切换递增，确保动画可重复播放 */
  animKey?: number;
};

/** 输入框沉底时的入场 */
export function ComposerDockMotion({ children, visible, animKey = 0 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = wrapRef.current;
      if (!el) return;
      if (!visible || prefersReducedMotion()) {
        gsapReveal(el);
        return;
      }
      gsap.fromTo(
        el,
        { autoAlpha: 0, y: 28 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.45,
          ease: "power3.out",
          onComplete: () => gsapReveal(el),
          onInterrupt: () => gsapReveal(el),
        },
      );
    },
    { scope: wrapRef, dependencies: [visible, animKey] },
  );

  if (!visible) return null;

  return (
    <div ref={wrapRef} className="chat-composer-dock-motion w-full">
      {children}
    </div>
  );
}
