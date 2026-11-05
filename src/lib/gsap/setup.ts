import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** 尊重系统「减少动效」设置 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 清掉 autoAlpha 残留的 visibility/opacity，避免入场动画中断后面板不可见、不可点。 */
export function gsapReveal(target: gsap.TweenTarget | null | undefined, extraClear = ""): void {
  if (target == null) return;
  const clearProps = extraClear
    ? `visibility,opacity,transform,${extraClear}`
    : "visibility,opacity,transform";
  gsap.set(target, { autoAlpha: 1, clearProps });
}

export { gsap, useGSAP };
