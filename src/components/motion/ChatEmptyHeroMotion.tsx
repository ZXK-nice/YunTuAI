import { useRef, type ReactNode } from "react";
import { gsap, gsapReveal, prefersReducedMotion, useGSAP } from "../../lib/gsap/setup";

type Props = {
  children: ReactNode;
  active?: boolean;
  exiting?: boolean;
};

function revealScope(scope: HTMLElement) {
  gsapReveal(scope);
  scope
    .querySelectorAll(
      ".chat-empty-hero__icon-wrap, .chat-empty-hero__title, .quick-start-chip, .chat-composer-inline-slot",
    )
    .forEach((el) => gsapReveal(el));
}

export function ChatEmptyHeroMotion({ children, active = true, exiting = false }: Props) {
  const scopeRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const scope = scopeRef.current;
      if (!scope) return;
      if (!active || prefersReducedMotion()) {
        revealScope(scope);
        return;
      }

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => revealScope(scope),
        onInterrupt: () => revealScope(scope),
      });
      const icon = scope.querySelector(".chat-empty-hero__icon-wrap");
      const title = scope.querySelector(".chat-empty-hero__title");
      const chips = scope.querySelectorAll(".quick-start-chip");
      const composer = scope.querySelector(".chat-composer-inline-slot");

      if (icon) {
        tl.fromTo(icon, { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.4 }, 0);
      }
      if (title) {
        tl.fromTo(title, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35 }, "-=0.22");
      }
      if (chips.length > 0) {
        tl.fromTo(
          chips,
          { autoAlpha: 0, y: 6 },
          { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.05 },
          "-=0.18",
        );
      }
      if (composer) {
        tl.fromTo(
          composer,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 0.38 },
          "-=0.12",
        );
      }
    },
    { scope: scopeRef, dependencies: [active] },
  );

  useGSAP(
    () => {
      if (!exiting || prefersReducedMotion()) return;
      const scope = scopeRef.current;
      if (!scope) return;
      gsap.to(scope, {
        autoAlpha: 0,
        y: -14,
        duration: 0.32,
        ease: "power2.in",
        onComplete: () => gsapReveal(scope),
        onInterrupt: () => gsapReveal(scope),
      });
    },
    { scope: scopeRef, dependencies: [exiting] },
  );

  return (
    <div
      ref={scopeRef}
      className={["chat-empty-hero-motion w-full", exiting ? "chat-empty-hero-motion--exiting" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
