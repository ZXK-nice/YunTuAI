import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap, prefersReducedMotion, useGSAP } from "../../lib/gsap/setup";

type TabItem = {
  id: string;
  label: string;
};

type TabIndicator = { x: number; y: number; w: number; h: number };

const INDICATOR_INIT: TabIndicator = { x: 0, y: 0, w: 0, h: 0 };
const HINT_RESERVE_PX = 34;
const CLIP_SAFETY_PX = 8;
const CLOSED_MIN_W = 118;

type Props = {
  tabs: TabItem[];
  activeTabId: string;
  onSelect: (id: string) => void;
};

/** 折叠模式下顶栏：当前标签为锚点，点击后整条标签向右丝滑展开 */
export const HeaderNavSlideRail = memo(function HeaderNavSlideRail({
  tabs,
  activeTabId,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const chevronRef = useRef<HTMLSpanElement>(null);
  const [indicator, setIndicator] = useState<TabIndicator>(INDICATOR_INIT);

  const activeLabel = tabs.find((t) => t.id === activeTabId)?.label ?? "工作区";

  const measureLayout = useCallback(() => {
    const strip = stripRef.current;
    const rail = railRef.current;
    const toggle = toggleRef.current;
    if (!strip) return { closed: 0, open: 0, offset: 0 };
    const activeBtn = strip.querySelector<HTMLButtonElement>(`[data-subtab-id="${activeTabId}"]`);
    const openW = Math.ceil(strip.scrollWidth);
    const activeW = activeBtn ? Math.ceil(activeBtn.getBoundingClientRect().width) : 88;
    const offset = activeBtn ? Math.ceil(activeBtn.offsetLeft) : 0;
    const toggleW = toggle ? Math.ceil(toggle.getBoundingClientRect().width) : HINT_RESERVE_PX;
    const railGap = rail ? Math.ceil(parseFloat(getComputedStyle(rail).gap) || 0) : 0;
    const railPad = rail
      ? Math.ceil(
          parseFloat(getComputedStyle(rail).paddingLeft) +
            parseFloat(getComputedStyle(rail).paddingRight),
        )
      : 0;
    const padEnd = toggleW + railGap + railPad || HINT_RESERVE_PX;
    const openOuterW = openW + padEnd;
    const closedW = Math.max(
      CLOSED_MIN_W,
      Math.min(openOuterW, activeW + padEnd + CLIP_SAFETY_PX),
    );
    return { closed: closedW, open: openOuterW, offset };
  }, [activeTabId]);

  const applyClosedLayout = useCallback(() => {
    const rail = railRef.current;
    const strip = stripRef.current;
    if (!rail || !strip) return;
    const { closed, offset } = measureLayout();
    gsap.set(rail, { width: closed });
    gsap.set(strip, { x: -offset });
  }, [measureLayout]);

  const updateTabIndicator = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLButtonElement>(`[data-subtab-id="${activeTabId}"]`);
    if (!active) return;
    const s = strip.getBoundingClientRect();
    const b = active.getBoundingClientRect();
    setIndicator({
      x: b.left - s.left,
      y: b.top - s.top,
      w: b.width,
      h: b.height,
    });
  }, [activeTabId]);

  useLayoutEffect(() => {
    applyClosedLayout();
    updateTabIndicator();
    const strip = stripRef.current;
    const toggle = toggleRef.current;
    if (!strip) return;
    const ro = new ResizeObserver(() => {
      updateTabIndicator();
      if (!open) applyClosedLayout();
    });
    ro.observe(strip);
    if (toggle) ro.observe(toggle);
    return () => ro.disconnect();
  }, [applyClosedLayout, updateTabIndicator, tabs.length, activeTabId, open]);

  useGSAP(
    () => {
      const rail = railRef.current;
      const strip = stripRef.current;
      const chevron = chevronRef.current;
      if (!rail || !strip) return;

      const { closed, open: openW, offset } = measureLayout();
      const targetW = open ? openW : closed;
      const targetX = open ? 0 : -offset;

      if (prefersReducedMotion()) {
        gsap.set(rail, { width: targetW });
        gsap.set(strip, { x: targetX });
        gsap.set(chevron, { rotation: open ? 180 : 0, opacity: 1 });
        if (open) updateTabIndicator();
        return;
      }

      gsap.killTweensOf([rail, strip, chevron]);

      gsap.to(rail, {
        width: targetW,
        duration: open ? 0.52 : 0.36,
        ease: open ? "power3.out" : "power2.inOut",
        overwrite: true,
      });

      gsap.to(strip, {
        x: targetX,
        duration: open ? 0.52 : 0.36,
        ease: open ? "power3.out" : "power2.inOut",
        overwrite: true,
        onComplete: () => {
          if (open) updateTabIndicator();
        },
      });

      gsap.to(chevron, {
        rotation: open ? 180 : 0,
        duration: 0.28,
        ease: "power2.out",
        overwrite: true,
      });

      if (open) {
        const tabEls = strip.querySelectorAll<HTMLElement>(".app-header-pill__tab");
        gsap.fromTo(
          tabEls,
          { opacity: 0.45, filter: "blur(2px)" },
          {
            opacity: 1,
            filter: "blur(0px)",
            duration: 0.34,
            stagger: 0.04,
            ease: "power2.out",
            delay: 0.08,
            overwrite: true,
          },
        );
      } else {
        gsap.set(strip.querySelectorAll(".app-header-pill__tab"), {
          opacity: 1,
          filter: "blur(0px)",
        });
      }
    },
    { dependencies: [open, activeTabId, tabs.length], scope: railRef },
  );

  useEffect(() => {
    if (open) return;
    applyClosedLayout();
  }, [open, activeTabId, applyClosedLayout]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!railRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleRailClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (open) return;
      if ((e.target as HTMLElement).closest(".app-header-pill__tab")) return;
      if ((e.target as HTMLElement).closest(".app-header-nav-rail__toggle")) return;
      setOpen(true);
    },
    [open],
  );

  const handleToggle = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setOpen((v) => !v);
    },
    [],
  );

  const handleSelect = useCallback(
    (id: string) => {
      if (!open) {
        if (id !== activeTabId) {
          onSelect(id);
          return;
        }
        setOpen(true);
        return;
      }
      onSelect(id);
      setOpen(false);
    },
    [activeTabId, onSelect, open],
  );

  return (
    <div
      ref={railRef}
      className={["app-header-nav-rail", open ? "app-header-nav-rail--open" : ""].join(" ")}
      onClick={handleRailClick}
      role="presentation"
    >
      {!open ? (
        <button
          type="button"
          className="app-header-nav-rail__veil yt-press"
          aria-expanded={false}
          aria-label={`${activeLabel}，点击向右展开导航`}
          onClick={() => setOpen(true)}
        />
      ) : null}

      <div className="app-header-nav-rail__clip">
        <div
          ref={stripRef}
          className={[
            "app-header-pill-strip app-header-pill-strip--rail relative flex items-stretch",
            open ? "app-header-pill-strip--rail-open" : "",
          ].join(" ")}
          role="tablist"
          aria-label="工作区子视图"
        >
          <div
            className="app-header-pill__glide pointer-events-none absolute left-0 top-0"
            style={{
              width: Math.max(0, indicator.w),
              height: Math.max(0, indicator.h),
              transform: `translate(${indicator.x}px, ${indicator.y}px)`,
              opacity: indicator.w > 0 ? 1 : 0,
            }}
            aria-hidden
          />
          {tabs.map((t) => {
            const on = activeTabId === t.id;
            return (
              <button
                key={t.id}
                data-subtab-id={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => handleSelect(t.id)}
                className={[
                  "app-header-pill__tab relative z-10",
                  on ? "app-header-pill__tab--active" : "",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <button
        ref={toggleRef}
        type="button"
        className="app-header-nav-rail__toggle yt-press"
        aria-expanded={open}
        aria-label={open ? "收起导航" : `${activeLabel}，展开导航`}
        title={open ? "收起" : "展开导航"}
        onClick={handleToggle}
      >
        <span ref={chevronRef} className="app-header-nav-rail__chevron" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="h-3.5 w-3.5">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
    </div>
  );
});
