import { useRef, type ReactNode } from "react";
import { gsap, gsapReveal, prefersReducedMotion, useGSAP } from "../../lib/gsap/setup";

type Props = {
  children: ReactNode;
};

function revealShell(sidebar: Element | null, main: Element | null) {
  gsapReveal(sidebar);
  gsapReveal(main);
}

export function AppShellEntrance({ children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      const sidebar = root.querySelector(".app-sidebar");
      const main = root.querySelector(".app-shell-main");
      if (prefersReducedMotion()) {
        revealShell(sidebar, main);
        return;
      }

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => revealShell(sidebar, main),
        onInterrupt: () => revealShell(sidebar, main),
      });

      if (sidebar) {
        tl.fromTo(
          sidebar,
          { autoAlpha: 0, x: -10 },
          { autoAlpha: 1, x: 0, duration: 0.45 },
          0,
        );
      }
      if (main) {
        tl.fromTo(
          main,
          { autoAlpha: 0, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.5 },
          0.06,
        );
      }
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="app-shell-entrance h-full min-h-0 min-w-0">
      {children}
    </div>
  );
}
